# ============================================================
# ShrimpDiseaseImageBD — Kaggle T4 training + deployment export
# Paste this complete file into ONE Kaggle notebook cell, or upload
# it as a .py file and run it. The script trains a group-aware
# five-fold EfficientNet-B0 ensemble and creates a deployment ZIP.
# ============================================================

import importlib.util
import subprocess
import sys

if importlib.util.find_spec("timm") is None:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "timm"])

import gc
import json
import math
import os
import random
import re
import shutil
import zipfile
from contextlib import nullcontext
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import timm
import torch
import torch.nn as nn
import torchvision.transforms as T
from PIL import Image, ImageFile, UnidentifiedImageError
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    precision_recall_fscore_support,
)
from sklearn.model_selection import StratifiedGroupKFold
from torch.utils.data import DataLoader, Dataset

ImageFile.LOAD_TRUNCATED_IMAGES = True

# ------------------------------------------------------------
# 1. Configuration
# ------------------------------------------------------------
SEED = 42
MODEL_NAME = "efficientnet_b0"
CLASS_NAMES = ["Healthy", "BG", "WSSV", "BG_WSSV"]
IMG_SIZE = 224
NORMALIZE_MEAN = [0.485, 0.456, 0.406]
NORMALIZE_STD = [0.229, 0.224, 0.225]

BATCH_SIZE = 16
EPOCHS = 60
EARLY_STOPPING_PATIENCE = 12
EARLY_STOPPING_MIN_DELTA = 1e-4
BACKBONE_LR = 5e-5
HEAD_LR = 3e-4
WEIGHT_DECAY = 1e-4
LABEL_SMOOTHING = 0.05
GRAD_CLIP_NORM = 1.0
NUM_WORKERS = 2

USE_CLASS_WEIGHTS = True
USE_TEST_TTA = False
VERIFY_ALL_IMAGES = False
PRETRAINED = True
MODEL_DROP_RATE = 0.25
MODEL_DROP_PATH_RATE = 0.10

# Run all five folds for an ensemble. For a quick test, use [0].
RUN_FOLDS = [0, 1, 2, 3, 4]

WORK_DIR = Path("/kaggle/working") if Path("/kaggle").exists() else Path("/mnt/data/kaggle_working")
OUTPUT_DIR = WORK_DIR / "shrimp_outputs"
DEPLOYMENT_DIR = OUTPUT_DIR / "deployment_bundle"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DEPLOYMENT_DIR.mkdir(parents=True, exist_ok=True)

SEARCH_DIRS = [
    Path("/kaggle/input"),
    Path("/kaggle/working"),
    Path("/mnt/data"),
    WORK_DIR,
]

IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
AMP_ENABLED = DEVICE.type == "cuda"
PIN_MEMORY = DEVICE.type == "cuda"

print("PyTorch:", torch.__version__)
print("timm:", timm.__version__)
print("Device:", DEVICE)
if torch.cuda.is_available():
    print("GPU:", torch.cuda.get_device_name(0))

if hasattr(torch, "set_float32_matmul_precision"):
    torch.set_float32_matmul_precision("high")

torch.backends.cudnn.benchmark = True


# ------------------------------------------------------------
# 2. Reproducibility
# ------------------------------------------------------------
def seed_everything(seed: int = SEED) -> None:
    os.environ["PYTHONHASHSEED"] = str(seed)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)


def seed_worker(worker_id: int) -> None:
    worker_seed = (torch.initial_seed() + worker_id) % (2**32)
    np.random.seed(worker_seed)
    random.seed(worker_seed)


seed_everything()


# ------------------------------------------------------------
# 3. Locate or extract dataset
# ------------------------------------------------------------
def normalized_folder_label(folder_name: str):
    text = re.sub(r"^\s*\d+\.\s*", "", folder_name.strip())
    text = re.sub(r"\s+", "_", text).upper()
    mapping = {
        "HEALTHY": "Healthy",
        "BG": "BG",
        "WSSV": "WSSV",
        "WSSV_BG": "BG_WSSV",
        "BG_WSSV": "BG_WSSV",
    }
    return mapping.get(text)


def class_subdirectories(candidate: Path):
    if not candidate.is_dir():
        return []
    return [
        child
        for child in candidate.iterdir()
        if child.is_dir() and normalized_folder_label(child.name) is not None
    ]


def looks_like_dataset_dir(path: Path) -> bool:
    labels = {normalized_folder_label(p.name) for p in class_subdirectories(path)}
    return set(CLASS_NAMES).issubset(labels)


def skip_zip_member(name: str) -> bool:
    normalized = name.replace("\\", "/")
    parts = normalized.split("/")
    base = Path(normalized).name
    return "__MACOSX" in parts or base.startswith("._") or base == ".DS_Store"


def safe_extract_zip(zip_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    destination_root = destination.resolve()
    with zipfile.ZipFile(zip_path, "r") as archive:
        for member in archive.infolist():
            if skip_zip_member(member.filename):
                continue
            target = destination / member.filename
            try:
                target.resolve().relative_to(destination_root)
            except ValueError:
                print("Skipped unsafe ZIP member:", member.filename)
                continue
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)


def image_count(path: Path) -> int:
    return sum(
        1
        for item in path.rglob("*")
        if item.is_file() and item.suffix.lower() in IMG_EXTS
    )


def find_dataset_dir(search_dirs):
    candidates = []
    for base in search_dirs:
        if not base.exists():
            continue
        if looks_like_dataset_dir(base):
            candidates.append(base)
        for path in base.rglob("*"):
            if path.is_dir() and looks_like_dataset_dir(path):
                candidates.append(path)
    if not candidates:
        return None
    return sorted(set(candidates), key=image_count, reverse=True)[0]


def prepare_dataset() -> Path:
    extraction_root = WORK_DIR / "shrimp_extracted"
    raw_dir = find_dataset_dir(SEARCH_DIRS + [extraction_root])
    if raw_dir is not None:
        print("Found dataset folder:", raw_dir)
        return raw_dir

    zip_candidates = []
    for base in SEARCH_DIRS:
        if base.exists():
            zip_candidates.extend(base.rglob("*.zip"))

    for zip_path in sorted(set(zip_candidates)):
        try:
            destination = extraction_root / re.sub(r"[^A-Za-z0-9_.-]+", "_", zip_path.stem)
            print("Extracting:", zip_path)
            safe_extract_zip(zip_path, destination)
            raw_dir = find_dataset_dir([destination])
            if raw_dir is not None:
                return raw_dir
        except zipfile.BadZipFile:
            print("Skipped invalid ZIP:", zip_path)
        except Exception as exc:
            print(f"Could not extract {zip_path}: {exc}")

    raise FileNotFoundError(
        "Could not find class folders Healthy, BG, WSSV and BG_WSSV. "
        "Add the dataset or its ZIP to Kaggle Input."
    )


RAW_DIR = prepare_dataset()
print("RAW_DIR:", RAW_DIR)


# ------------------------------------------------------------
# 4. Build dataframe and shrimp-level groups
# ------------------------------------------------------------
def extract_shrimp_group(path: Path, label: str) -> str:
    match = re.match(r"^(.+?)-(\d+)-img-(\d+)$", path.stem, flags=re.IGNORECASE)
    if match:
        return f"{label}_{match.group(2)}"
    base = re.sub(r"-img-\d+$", "", path.stem, flags=re.IGNORECASE)
    return f"{label}_{base}"


def image_is_readable(path: str) -> bool:
    try:
        with Image.open(path) as image:
            image.verify()
        return True
    except (OSError, ValueError, UnidentifiedImageError):
        return False


def build_dataframe(raw_dir: Path) -> pd.DataFrame:
    rows = []
    for class_dir in class_subdirectories(raw_dir):
        label = normalized_folder_label(class_dir.name)
        for image_path in class_dir.rglob("*"):
            if not image_path.is_file() or image_path.suffix.lower() not in IMG_EXTS:
                continue
            if "__MACOSX" in image_path.parts or image_path.name.startswith("._"):
                continue
            rows.append(
                {
                    "path": str(image_path),
                    "label": label,
                    "group": extract_shrimp_group(image_path, label),
                }
            )

    dataframe = pd.DataFrame(rows).drop_duplicates(subset=["path"])
    if dataframe.empty:
        raise RuntimeError("No supported images were found.")

    if VERIFY_ALL_IMAGES:
        readable = dataframe["path"].map(image_is_readable)
        print("Unreadable images removed:", int((~readable).sum()))
        dataframe = dataframe.loc[readable].copy()

    return dataframe.sort_values(["label", "group", "path"]).reset_index(drop=True)


df = build_dataframe(RAW_DIR)
class_to_idx = {name: idx for idx, name in enumerate(CLASS_NAMES)}
idx_to_class = {idx: name for name, idx in class_to_idx.items()}
df["label_idx"] = df["label"].map(class_to_idx)

if df["label_idx"].isna().any():
    raise ValueError("Unexpected class folder was found.")

df["label_idx"] = df["label_idx"].astype(int)

print("\nClass distribution:")
print(df["label"].value_counts().reindex(CLASS_NAMES, fill_value=0))
print("\nUnique shrimp groups:")
print(df.groupby("label")["group"].nunique().reindex(CLASS_NAMES, fill_value=0))
print("Total images:", len(df))
print("Total groups:", df["group"].nunique())

# Group-aware folds prevent images from the same shrimp appearing in
# training and validation/test at the same time.
splitter = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED)
df["fold"] = -1
for fold, (_, held_out_idx) in enumerate(
    splitter.split(df["path"], df["label_idx"], groups=df["group"])
):
    df.loc[held_out_idx, "fold"] = fold

if (df["fold"] < 0).any():
    raise RuntimeError("Fold assignment failed.")

print("\nFold distribution:")
print(pd.crosstab(df["fold"], df["label"]).reindex(columns=CLASS_NAMES, fill_value=0))
df.to_csv(OUTPUT_DIR / "shrimp_dataframe_with_folds.csv", index=False)


# ------------------------------------------------------------
# 5. Transforms and dataset
# ------------------------------------------------------------
train_tfms = T.Compose(
    [
        T.RandomResizedCrop(
            IMG_SIZE,
            scale=(0.78, 1.00),
            ratio=(0.85, 1.15),
            interpolation=T.InterpolationMode.BICUBIC,
        ),
        T.RandomHorizontalFlip(p=0.50),
        T.RandomVerticalFlip(p=0.10),
        T.RandomRotation(12, interpolation=T.InterpolationMode.BILINEAR, fill=0),
        T.ColorJitter(brightness=0.12, contrast=0.12, saturation=0.10, hue=0.03),
        T.ToTensor(),
        T.Normalize(NORMALIZE_MEAN, NORMALIZE_STD),
        T.RandomErasing(p=0.15, scale=(0.02, 0.10), ratio=(0.5, 2.0), value="random"),
    ]
)

valid_tfms = T.Compose(
    [
        T.Resize((IMG_SIZE, IMG_SIZE), interpolation=T.InterpolationMode.BICUBIC),
        T.ToTensor(),
        T.Normalize(NORMALIZE_MEAN, NORMALIZE_STD),
    ]
)


class ShrimpDataset(Dataset):
    def __init__(self, dataframe: pd.DataFrame, transform):
        self.df = dataframe.reset_index(drop=True).copy()
        self.transform = transform

    def __len__(self):
        return len(self.df)

    def __getitem__(self, index: int):
        row = self.df.iloc[index]
        try:
            with Image.open(row["path"]) as image:
                image = image.convert("RGB")
        except Exception as exc:
            raise RuntimeError(f"Could not read image: {row['path']}") from exc
        image = self.transform(image)
        label = torch.tensor(int(row["label_idx"]), dtype=torch.long)
        return image, label, index


def create_loader(dataset: Dataset, shuffle: bool, seed: int):
    generator = torch.Generator()
    generator.manual_seed(seed)
    return DataLoader(
        dataset,
        batch_size=BATCH_SIZE,
        shuffle=shuffle,
        num_workers=NUM_WORKERS,
        pin_memory=PIN_MEMORY,
        persistent_workers=NUM_WORKERS > 0,
        worker_init_fn=seed_worker,
        generator=generator,
        drop_last=False,
    )


# ------------------------------------------------------------
# 6. Model, optimizer and AMP helpers
# ------------------------------------------------------------
def create_model(pretrained: bool):
    attempts = [
        {"drop_rate": MODEL_DROP_RATE, "drop_path_rate": MODEL_DROP_PATH_RATE},
        {"drop_rate": MODEL_DROP_RATE},
        {},
    ]
    last_error = None
    for use_pretrained in ([pretrained, False] if pretrained else [False]):
        for kwargs in attempts:
            try:
                model = timm.create_model(
                    MODEL_NAME,
                    pretrained=use_pretrained,
                    num_classes=len(CLASS_NAMES),
                    **kwargs,
                )
                print(f"Created {MODEL_NAME}; pretrained={use_pretrained}; args={kwargs}")
                return model
            except Exception as exc:
                last_error = exc
        if use_pretrained:
            print("Pretrained weights unavailable; retrying without them.")
    raise RuntimeError(f"Could not create model: {last_error}")


def split_parameter_groups(model: nn.Module):
    classifier = model.get_classifier()
    head_params = list(classifier.parameters())
    head_ids = {id(param) for param in head_params}
    backbone_params = [param for param in model.parameters() if id(param) not in head_ids]
    return [
        {"params": backbone_params, "lr": BACKBONE_LR},
        {"params": head_params, "lr": HEAD_LR},
    ]


def make_scaler():
    try:
        return torch.amp.GradScaler("cuda", enabled=AMP_ENABLED)
    except (AttributeError, TypeError):
        return torch.cuda.amp.GradScaler(enabled=AMP_ENABLED)


def amp_context():
    if not AMP_ENABLED:
        return nullcontext()
    try:
        return torch.amp.autocast(device_type="cuda", dtype=torch.float16)
    except AttributeError:
        return torch.cuda.amp.autocast(dtype=torch.float16)


def load_checkpoint(path: Path):
    try:
        return torch.load(path, map_location=DEVICE, weights_only=False)
    except TypeError:
        return torch.load(path, map_location=DEVICE)


# ------------------------------------------------------------
# 7. Metrics, training and evaluation
# ------------------------------------------------------------
def calculate_metrics(y_true, y_pred):
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true,
        y_pred,
        labels=list(range(len(CLASS_NAMES))),
        average="macro",
        zero_division=0,
    )
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "precision_macro": float(precision),
        "recall_macro": float(recall),
        "f1_macro": float(f1),
    }


def train_one_epoch(model, loader, criterion, optimizer, scaler):
    model.train()
    total_loss = 0.0
    y_true, y_pred = [], []

    for images, labels, _ in loader:
        images = images.to(DEVICE, non_blocking=True)
        labels = labels.to(DEVICE, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)

        with amp_context():
            logits = model(images)
            loss = criterion(logits, labels)

        if not torch.isfinite(loss):
            raise FloatingPointError(f"Non-finite training loss: {loss.item()}")

        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP_NORM)
        scaler.step(optimizer)
        scaler.update()

        total_loss += loss.item() * images.size(0)
        y_true.extend(labels.detach().cpu().tolist())
        y_pred.extend(logits.detach().argmax(1).cpu().tolist())

    metrics = calculate_metrics(y_true, y_pred)
    metrics["loss"] = total_loss / len(loader.dataset)
    return metrics


@torch.inference_mode()
def evaluate(model, loader, criterion, use_tta: bool = False):
    model.eval()
    total_loss = 0.0
    y_true, y_pred, probabilities, row_indices = [], [], [], []

    for images, labels, indices in loader:
        images = images.to(DEVICE, non_blocking=True)
        labels = labels.to(DEVICE, non_blocking=True)

        with amp_context():
            logits = model(images)
            if use_tta:
                logits = (logits + model(torch.flip(images, dims=[3]))) / 2.0
            loss = criterion(logits, labels)

        probs = torch.softmax(logits.float(), dim=1)
        total_loss += loss.item() * images.size(0)
        y_true.extend(labels.cpu().tolist())
        y_pred.extend(probs.argmax(1).cpu().tolist())
        probabilities.append(probs.cpu().numpy())
        row_indices.extend(indices.tolist())

    metrics = calculate_metrics(y_true, y_pred)
    metrics["loss"] = total_loss / len(loader.dataset)
    return {
        "metrics": metrics,
        "y_true": np.asarray(y_true),
        "y_pred": np.asarray(y_pred),
        "probabilities": np.concatenate(probabilities),
        "row_indices": np.asarray(row_indices),
    }


# ------------------------------------------------------------
# 8. Output helpers
# ------------------------------------------------------------
def save_training_curves(history_df: pd.DataFrame, prefix: Path):
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(history_df["epoch"], history_df["train_loss"], label="Train loss")
    ax.plot(history_df["epoch"], history_df["val_loss"], label="Validation loss")
    ax.set_xlabel("Epoch")
    ax.set_ylabel("Loss")
    ax.set_title("Training and Validation Loss")
    ax.legend()
    fig.tight_layout()
    fig.savefig(prefix.with_name(prefix.name + "_loss.png"), dpi=200, bbox_inches="tight")
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(history_df["epoch"], history_df["train_f1_macro"], label="Train macro F1")
    ax.plot(history_df["epoch"], history_df["val_f1_macro"], label="Validation macro F1")
    ax.set_xlabel("Epoch")
    ax.set_ylabel("Macro F1")
    ax.set_title("Training and Validation Macro F1")
    ax.legend()
    fig.tight_layout()
    fig.savefig(prefix.with_name(prefix.name + "_f1.png"), dpi=200, bbox_inches="tight")
    plt.close(fig)


def save_confusion_matrix(y_true, y_pred, suffix: str):
    for normalize, name, fmt in [(None, "raw", "d"), ("true", "normalized", ".2f")]:
        matrix = confusion_matrix(
            y_true,
            y_pred,
            labels=list(range(len(CLASS_NAMES))),
            normalize=normalize,
        )
        fig, ax = plt.subplots(figsize=(7, 6))
        image = ax.imshow(matrix)
        ax.set_xticks(range(len(CLASS_NAMES)))
        ax.set_yticks(range(len(CLASS_NAMES)))
        ax.set_xticklabels(CLASS_NAMES, rotation=45, ha="right")
        ax.set_yticklabels(CLASS_NAMES)
        ax.set_xlabel("Predicted label")
        ax.set_ylabel("True label")
        ax.set_title(f"Confusion Matrix ({name})")
        threshold = matrix.max() / 2 if matrix.size else 0
        for row in range(len(CLASS_NAMES)):
            for col in range(len(CLASS_NAMES)):
                value = matrix[row, col]
                ax.text(
                    col,
                    row,
                    format(value, fmt),
                    ha="center",
                    va="center",
                    color="white" if value > threshold else "black",
                )
        fig.colorbar(image, ax=ax)
        fig.tight_layout()
        fig.savefig(OUTPUT_DIR / f"confusion_{suffix}_{name}.png", dpi=200, bbox_inches="tight")
        plt.close(fig)


def assert_no_group_overlap(train_df, val_df, test_df):
    train_groups = set(train_df["group"])
    val_groups = set(val_df["group"])
    test_groups = set(test_df["group"])
    if train_groups & val_groups or train_groups & test_groups or val_groups & test_groups:
        raise RuntimeError("Group leakage detected.")
    print("Group leakage check: PASSED")


# ------------------------------------------------------------
# 9. Train one fold
# ------------------------------------------------------------
def run_fold(test_fold: int):
    val_fold = (test_fold + 1) % 5
    train_df = df.loc[~df["fold"].isin([test_fold, val_fold])].reset_index(drop=True)
    val_df = df.loc[df["fold"] == val_fold].reset_index(drop=True)
    test_df = df.loc[df["fold"] == test_fold].reset_index(drop=True)
    assert_no_group_overlap(train_df, val_df, test_df)

    print("\n" + "=" * 88)
    print(f"Test fold: {test_fold}; validation fold: {val_fold}")
    print("Train/validation/test:", len(train_df), len(val_df), len(test_df))
    print("=" * 88)

    train_loader = create_loader(
        ShrimpDataset(train_df, train_tfms), True, SEED + test_fold
    )
    val_loader = create_loader(
        ShrimpDataset(val_df, valid_tfms), False, SEED + test_fold
    )
    test_loader = create_loader(
        ShrimpDataset(test_df, valid_tfms), False, SEED + test_fold
    )

    model = create_model(PRETRAINED).to(DEVICE)
    parameter_count_m = sum(p.numel() for p in model.parameters()) / 1e6
    print(f"Parameters: {parameter_count_m:.3f} M")

    class_counts = np.bincount(
        train_df["label_idx"].to_numpy(), minlength=len(CLASS_NAMES)
    ).astype(np.float64)
    if np.any(class_counts == 0):
        raise ValueError(f"A class is missing from training: {class_counts}")

    class_weights = len(train_df) / (len(CLASS_NAMES) * class_counts)
    weight_tensor = (
        torch.tensor(class_weights, dtype=torch.float32, device=DEVICE)
        if USE_CLASS_WEIGHTS
        else None
    )

    criterion = nn.CrossEntropyLoss(
        weight=weight_tensor,
        label_smoothing=LABEL_SMOOTHING,
    )
    optimizer = torch.optim.AdamW(
        split_parameter_groups(model),
        weight_decay=WEIGHT_DECAY,
    )
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer,
        mode="max",
        factor=0.5,
        patience=3,
        threshold=1e-3,
        min_lr=1e-7,
    )
    scaler = make_scaler()

    checkpoint_path = OUTPUT_DIR / f"best_{MODEL_NAME}_fold{test_fold}.pth"
    metadata_path = OUTPUT_DIR / f"best_{MODEL_NAME}_fold{test_fold}_metadata.json"
    history_path = OUTPUT_DIR / f"history_{MODEL_NAME}_fold{test_fold}.csv"

    best_val_f1 = -math.inf
    best_epoch = -1
    without_improvement = 0
    history = []

    for epoch in range(1, EPOCHS + 1):
        train_metrics = train_one_epoch(model, train_loader, criterion, optimizer, scaler)
        val_output = evaluate(model, val_loader, criterion, use_tta=False)
        val_metrics = val_output["metrics"]
        scheduler.step(val_metrics["f1_macro"])
        lrs = [group["lr"] for group in optimizer.param_groups]

        history.append(
            {
                "epoch": epoch,
                **{f"train_{key}": value for key, value in train_metrics.items()},
                **{f"val_{key}": value for key, value in val_metrics.items()},
                "backbone_lr": lrs[0],
                "head_lr": lrs[-1],
            }
        )

        print(
            f"Epoch {epoch:03d}/{EPOCHS} | "
            f"train loss={train_metrics['loss']:.4f} F1={train_metrics['f1_macro']:.4f} | "
            f"val loss={val_metrics['loss']:.4f} acc={val_metrics['accuracy']:.4f} "
            f"F1={val_metrics['f1_macro']:.4f} | LR={lrs[0]:.2e}/{lrs[-1]:.2e}"
        )

        improved = val_metrics["f1_macro"] > best_val_f1 + EARLY_STOPPING_MIN_DELTA
        if improved:
            best_val_f1 = val_metrics["f1_macro"]
            best_epoch = epoch
            without_improvement = 0
            checkpoint = {
                "state_dict": model.state_dict(),
                "model_name": MODEL_NAME,
                "class_names": CLASS_NAMES,
                "class_to_idx": class_to_idx,
                "img_size": IMG_SIZE,
                "normalize_mean": NORMALIZE_MEAN,
                "normalize_std": NORMALIZE_STD,
                "fold": test_fold,
                "validation_fold": val_fold,
                "best_epoch": best_epoch,
                "best_validation_macro_f1": best_val_f1,
                "timm_version": timm.__version__,
                "torch_version": torch.__version__,
            }
            torch.save(checkpoint, checkpoint_path)
            with open(metadata_path, "w", encoding="utf-8") as file:
                json.dump(
                    {key: value for key, value in checkpoint.items() if key != "state_dict"},
                    file,
                    indent=2,
                )
        else:
            without_improvement += 1

        if without_improvement >= EARLY_STOPPING_PATIENCE:
            print(
                f"Early stopping. Best epoch={best_epoch}; "
                f"best validation macro F1={best_val_f1:.4f}"
            )
            break

    history_df = pd.DataFrame(history)
    history_df.to_csv(history_path, index=False)
    save_training_curves(history_df, OUTPUT_DIR / f"curves_{MODEL_NAME}_fold{test_fold}")

    checkpoint = load_checkpoint(checkpoint_path)
    model.load_state_dict(checkpoint["state_dict"])
    test_output = evaluate(model, test_loader, criterion, use_tta=USE_TEST_TTA)
    metrics = test_output["metrics"]

    report = classification_report(
        test_output["y_true"],
        test_output["y_pred"],
        labels=list(range(len(CLASS_NAMES))),
        target_names=CLASS_NAMES,
        digits=4,
        zero_division=0,
    )
    print("\nBest checkpoint test results:")
    print(json.dumps(metrics, indent=2))
    print("\nClassification report:\n", report)
    with open(
        OUTPUT_DIR / f"classification_report_{MODEL_NAME}_fold{test_fold}.txt",
        "w",
        encoding="utf-8",
    ) as file:
        file.write(report)

    prediction_df = test_df.iloc[test_output["row_indices"]].reset_index(drop=True).copy()
    prediction_df["predicted_label"] = [idx_to_class[idx] for idx in test_output["y_pred"]]
    prediction_df["correct"] = test_output["y_true"] == test_output["y_pred"]
    for class_index, class_name in enumerate(CLASS_NAMES):
        prediction_df[f"prob_{class_name}"] = test_output["probabilities"][:, class_index]
    prediction_df.to_csv(
        OUTPUT_DIR / f"test_predictions_{MODEL_NAME}_fold{test_fold}.csv",
        index=False,
    )
    save_confusion_matrix(test_output["y_true"], test_output["y_pred"], f"fold{test_fold}")

    # Copy only deployment-relevant files into the bundle directory.
    shutil.copy2(checkpoint_path, DEPLOYMENT_DIR / checkpoint_path.name)
    shutil.copy2(metadata_path, DEPLOYMENT_DIR / metadata_path.name)

    result = {
        "model": MODEL_NAME,
        "test_fold": test_fold,
        "validation_fold": val_fold,
        "best_epoch": best_epoch,
        "best_validation_macro_f1": best_val_f1,
        "parameters_million": parameter_count_m,
        **{f"test_{key}": value for key, value in metrics.items()},
        "checkpoint": checkpoint_path.name,
    }

    del model, optimizer, scheduler, scaler
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return result


# ------------------------------------------------------------
# 10. Run folds and create deployment ZIP
# ------------------------------------------------------------
results = []
for fold in RUN_FOLDS:
    if fold not in range(5):
        raise ValueError("RUN_FOLDS values must be from 0 to 4.")
    seed_everything(SEED + fold)
    results.append(run_fold(fold))

results_df = pd.DataFrame(results)
results_df.to_csv(OUTPUT_DIR / "all_model_results.csv", index=False)
print("\nPer-fold results:")
print(results_df.to_string(index=False))

metric_columns = [
    "test_accuracy",
    "test_balanced_accuracy",
    "test_precision_macro",
    "test_recall_macro",
    "test_f1_macro",
]
summary = {}
for column in metric_columns:
    summary[column] = {
        "mean": float(results_df[column].mean()),
        "std": float(results_df[column].std(ddof=1)) if len(results_df) > 1 else 0.0,
    }

manifest = {
    "project": "ShrimpDiseaseImageBD classifier",
    "model_name": MODEL_NAME,
    "class_names": CLASS_NAMES,
    "class_to_idx": class_to_idx,
    "img_size": IMG_SIZE,
    "normalize_mean": NORMALIZE_MEAN,
    "normalize_std": NORMALIZE_STD,
    "ensemble_strategy": "mean_softmax_probability",
    "checkpoint_files": [row["checkpoint"] for row in results],
    "number_of_models": len(results),
    "cross_validation_summary": summary,
    "warning": (
        "Research screening prototype only. Predictions must not replace "
        "laboratory confirmation or aquatic animal health expertise."
    ),
}

with open(DEPLOYMENT_DIR / "model_manifest.json", "w", encoding="utf-8") as file:
    json.dump(manifest, file, indent=2)

with open(OUTPUT_DIR / "five_fold_summary.json", "w", encoding="utf-8") as file:
    json.dump(summary, file, indent=2)

zip_path = OUTPUT_DIR / "shrimp_model_deployment_bundle.zip"
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for file_path in sorted(DEPLOYMENT_DIR.iterdir()):
        archive.write(file_path, arcname=file_path.name)

print("\nDeployment bundle created:", zip_path)
print("Copy the ZIP contents into ml-service/models/ in the web project.")
print("All outputs saved under:", OUTPUT_DIR)
