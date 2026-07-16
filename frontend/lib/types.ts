export type User = {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  createdAt: string;
};

export type Prediction = {
  id: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  predictedClass: "Healthy" | "BG" | "WSSV" | "BG_WSSV";
  confidence: number;
  probabilities: Record<string, number>;
  modelName: string;
  modelVersion: string;
  ensembleSize: number;
  lowConfidence: boolean;
  createdAt: string;
};

export type PredictionResponse = {
  prediction: Prediction;
  confidencePercentage: number;
  disclaimer: string;
};
