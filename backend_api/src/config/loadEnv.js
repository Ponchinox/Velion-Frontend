import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Cargar explícitamente backend_api/.env (determinista según la ubicación del código)
const backendEnvPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: backendEnvPath });

// 2. Fallback complementario a .env en process.cwd() si existe y no solapa
dotenv.config();

export const ENV_PATH = backendEnvPath;
