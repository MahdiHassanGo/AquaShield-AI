from __future__ import annotations

import io
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import timm
import torch
import torchvision.transforms as T
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

MODEL_DIR = Path(os.getenv("MODEL_DIR", "models"))
MODEL_PATTERN = os.getenv("MODEL_PATTERN", "best_efficientnet_b0_fold*.pth")
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(4 * 1024 * 1024)))
LOW_CONFIDENCE_THRESHOLD = float(os.getenv("LOW_CONFIDENCE_THRESHOLD", "0.60"))
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}

DEFAULT_MODEL_NAME = "efficientnet_b0"
DEFAULT_CLASS_NAMES = ["Healthy", "BG", "WSSV", "BG_WSSV"]
DEFAULT_IMG_SIZE = 224
DEFAULT_MEAN = [0.485, 0.456, 0.406]
DEFAULT_STD = [0.229, 0.224, 0.225]

models: list[torch.nn.Module] = []
model_files: list[str] = []
manifest: dict[str, Any] = {}
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
transform: T.Compose | None = None
class_names: list[str] = DEFAULT_CLASS_NAMES
model_name = DEFAULT_MODEL_NAME
img_size = DEFAULT_IMG_SIZE
normalization_mean = DEFAULT_MEAN
normalization_std = DEFAULT_STD


def parse_allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def safe_torch_load(path: Path) -> Any:
    # These checkpoint files are produced by the included Kaggle script.
    try:
        return torch.load(path, map_location=device, weights_only=False)
    except TypeError:
        return torch.load(path, map_location=device)


def normalize_state_dict_keys(state_dict: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    if not state_dict:
        return state_dict
    if all(key.startswith("module.") for key in state_dict):
        return {key.removeprefix("module."): value for key, value in state_dict.items()}
    return state_dict


def checkpoint_state_dict(checkpoint: Any) -> dict[str, torch.Tensor]:
    if isinstance(checkpoint, dict) and "state_dict" in checkpoint:
        return normalize_state_dict_keys(checkpoint["state_dict"])
    if isinstance(checkpoint, dict) and checkpoint and all(
        isinstance(value, torch.Tensor) for value in checkpoint.values()
    ):
        return normalize_state_dict_keys(checkpoint)
    raise RuntimeError("Unsupported checkpoint format.")


def resolve_checkpoint_files() -> list[Path]:
    manifest_files = manifest.get("checkpoint_files", [])
    paths = [MODEL_DIR / name for name in manifest_files if (MODEL_DIR / name).exists()]
    if not paths:
        paths = sorted(MODEL_DIR.glob(MODEL_PATTERN))
    if not paths:
        paths = sorted(MODEL_DIR.glob("*.pth"))
    return paths


def configure_from_manifest() -> None:
    global manifest, class_names, model_name, img_size, normalization_mean, normalization_std

    manifest = load_json(MODEL_DIR / "model_manifest.json")
    model_name = str(manifest.get("model_name", DEFAULT_MODEL_NAME))
    class_names = list(manifest.get("class_names", DEFAULT_CLASS_NAMES))
    img_size = int(manifest.get("img_size", DEFAULT_IMG_SIZE))
    normalization_mean = list(manifest.get("normalize_mean", DEFAULT_MEAN))
    normalization_std = list(manifest.get("normalize_std", DEFAULT_STD))


def load_models() -> None:
    global models, model_files, transform

    configure_from_manifest()
    checkpoint_paths = resolve_checkpoint_files()
    if not checkpoint_paths:
        raise RuntimeError(
            f"No .pth checkpoints found in {MODEL_DIR.resolve()}. "
            "Extract the Kaggle deployment ZIP into this directory."
        )

    loaded_models: list[torch.nn.Module] = []
    loaded_names: list[str] = []

    for checkpoint_path in checkpoint_paths:
        checkpoint = safe_torch_load(checkpoint_path)

        checkpoint_model_name = model_name
        checkpoint_classes = class_names
        if isinstance(checkpoint, dict) and "state_dict" in checkpoint:
            checkpoint_model_name = str(checkpoint.get("model_name", model_name))
            checkpoint_classes = list(checkpoint.get("class_names", class_names))

        if checkpoint_classes != class_names:
            raise RuntimeError(
                f"Class order mismatch in {checkpoint_path.name}: "
                f"{checkpoint_classes} != {class_names}"
            )

        network = timm.create_model(
            checkpoint_model_name,
            pretrained=False,
            num_classes=len(class_names),
        )
        network.load_state_dict(checkpoint_state_dict(checkpoint), strict=True)
        network.to(device)
        network.eval()
        loaded_models.append(network)
        loaded_names.append(checkpoint_path.name)

    models = loaded_models
    model_files = loaded_names
    transform = T.Compose(
        [
            T.Resize(
                (img_size, img_size),
                interpolation=T.InterpolationMode.BICUBIC,
            ),
            T.ToTensor(),
            T.Normalize(normalization_mean, normalization_std),
        ]
    )

    print(
        f"Loaded {len(models)} model(s) on {device}: "
        + ", ".join(model_files)
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_models()
    yield
    models.clear()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


app = FastAPI(
    title="Shrimp Disease Model Service",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok" if models else "not_ready",
        "device": str(device),
        "modelName": model_name,
        "ensembleSize": len(models),
        "checkpoints": model_files,
        "classes": class_names,
    }


@app.post("/predict")
async def predict(image: UploadFile = File(...)) -> dict[str, Any]:
    if not models or transform is None:
        raise HTTPException(status_code=503, detail="Model service is not ready.")

    if image.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Only JPEG, PNG and WebP images are accepted.",
        )

    data = await image.read(MAX_IMAGE_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image exceeds the {MAX_IMAGE_BYTES // (1024 * 1024)} MB limit.",
        )

    try:
        with Image.open(io.BytesIO(data)) as pil_image:
            rgb_image = pil_image.convert("RGB")
            tensor = transform(rgb_image).unsqueeze(0).to(device)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="The file is not a valid image.") from exc

    fold_probabilities = []
    with torch.inference_mode():
        for network in models:
            logits = network(tensor)
            fold_probabilities.append(torch.softmax(logits.float(), dim=1))

    ensemble_probabilities = torch.stack(fold_probabilities).mean(dim=0)[0]
    confidence, predicted_index = torch.max(ensemble_probabilities, dim=0)

    probabilities = {
        label: round(float(ensemble_probabilities[index].item()), 6)
        for index, label in enumerate(class_names)
    }
    confidence_value = float(confidence.item())
    predicted_label = class_names[int(predicted_index.item())]

    return {
        "className": predicted_label,
        "confidence": round(confidence_value, 6),
        "confidencePercentage": round(confidence_value * 100, 2),
        "isLowConfidence": confidence_value < LOW_CONFIDENCE_THRESHOLD,
        "probabilities": probabilities,
        "modelName": model_name,
        "modelVersion": "five-fold-ensemble-v1" if len(models) > 1 else "single-fold-v1",
        "ensembleSize": len(models),
        "input": {
            "fileName": image.filename,
            "mimeType": image.content_type,
            "imageSize": [img_size, img_size],
        },
        "disclaimer": (
            "Experimental screening prediction only; do not replace laboratory "
            "confirmation or professional aquatic animal health assessment."
        ),
    }
