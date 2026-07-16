# AquaShield AI — Shrimp Disease Classification

> **Live Demo**: [https://aqua-shield-ai.vercel.app/](https://aqua-shield-ai.vercel.app/)
>
> * **Backend API**: `https://aquashield-ai-1.onrender.com`
> * **FastAPI ML Inference**: `https://aquashield-ai-rcgc.onrender.com`

A complete research-prototype application for classifying shrimp images into:

- `Healthy` — No visible disease signs
- `BG` — Black Gill disease
- `WSSV` — White Spot Syndrome Virus infection
- `BG_WSSV` — Combined Black Gill and WSSV condition

The system uses a **Next.js frontend**, **Express.js TypeScript API**, **PostgreSQL with Prisma**, and a **FastAPI/PyTorch inference service**. The Kaggle script trains an EfficientNet-B0 five-fold ensemble and exports exactly the files used by the web application.

> Important: This is an experimental screening system. It must not be presented as a replacement for laboratory confirmation or professional aquatic animal health assessment.

## User Interface & Diagnostics Panel

Here are the interface screens of the modernized **AquaShield AI** application:

### 1. Landing Page
![Landing Page](images/landing_page.png)

### 2. Diagnostics Panel (Specimen Scan & Inference)
![Diagnostics Panel](images/diagnostics_panel.png)

### 3. Diagnostic Archive Logs
![Prediction History Logs](images/prediction_history.png)

### 4. Secure Access Portal
![Secure Portal](images/secure_portal.png)

## Project structure

```text
shrimp-disease-platform/
├── kaggle/
│   ├── shrimp_training_export.py
│   └── shrimp_training_export.ipynb
├── ml-service/
│   ├── app/main.py
│   ├── models/
│   ├── requirements.txt
│   └── Dockerfile
├── backend/
│   ├── prisma/schema.prisma
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## How one prediction works

```text
Mobile camera/gallery/file manager
            ↓
Next.js sends multipart/form-data
            ↓
Express validates authentication, MIME type and size
            ↓
FastAPI converts to RGB and applies 224×224 inference preprocessing
            ↓
1–5 EfficientNet-B0 checkpoints produce probabilities
            ↓
Mean probability gives final class and confidence
            ↓
Express saves the result through Prisma/PostgreSQL
            ↓
Next.js displays probabilities and prediction history
```


## Main API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Database and model-service health |
| `POST` | `/api/auth/register` | Register user |
| `POST` | `/api/auth/login` | Login and receive access token |
| `GET` | `/api/auth/me` | Current user |
| `POST` | `/api/predictions` | Upload and classify image |
| `GET` | `/api/predictions` | User prediction history |
| `GET` | `/api/predictions/stats/summary` | User class statistics |
| `GET` | `/api/predictions/:id` | One saved prediction |
| `DELETE` | `/api/predictions/:id` | Delete one saved prediction |



### PostgreSQL

Use a managed PostgreSQL provider. Place its connection string in `DATABASE_URL`. Use a pooled connection string when your provider recommends it.

### PyTorch service

Deploy `ml-service/` to a Docker-capable host with enough memory for the model ensemble. Copy the model bundle into the image or mount it from persistent storage. Set the backend `ML_SERVICE_URL` to its HTTPS URL.

### Camera access

Mobile browser camera capture is most reliable on an **HTTPS** deployed frontend. The frontend provides separate camera and gallery/file inputs because browser behavior differs across Android, iOS and desktop devices.

## Security already included

- Password hashing with bcrypt
- JWT authentication
- Helmet security headers
- CORS origin allow-list
- API rate limiting
- Server-side Zod validation
- Image MIME allow-list
- 8 MB upload limit
- User-scoped prediction queries and deletion
- No uploaded image is permanently stored by default

For a public production application, the next security upgrade should be replacing browser `localStorage` access tokens with short-lived access tokens and secure HttpOnly refresh cookies.

## Model consistency rules

Never change these values independently in the web service:

```text
Model: efficientnet_b0
Input: RGB
Size: 224 × 224
Class order: Healthy, BG, WSSV, BG_WSSV
Mean: 0.485, 0.456, 0.406
Std: 0.229, 0.224, 0.225
```

The included inference service reads these values from `model_manifest.json` so the training and deployment configurations remain aligned.

## Common errors

### `No .pth checkpoints found`

Extract `shrimp_model_deployment_bundle.zip` into `ml-service/models/`.

### `Model service is unavailable`

Confirm FastAPI is running at the URL used by `ML_SERVICE_URL`.

### Prisma cannot connect

Confirm PostgreSQL is running and `DATABASE_URL` uses the correct hostname. From your computer use `localhost`; inside Docker Compose use `postgres`.

### Camera button opens only a file chooser

This depends on browser/device support. Test on a phone over HTTPS. The gallery/file button remains available as a fallback.

### Low-confidence prediction

Capture another well-lit close image with the shrimp occupying most of the frame. Do not treat a low-confidence output as a reliable disease finding.
