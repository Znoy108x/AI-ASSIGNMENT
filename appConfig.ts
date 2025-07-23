import { config } from "dotenv";

config();

interface AppConfig {
  OPENAI_API_KEY: string;
  GEMINI_API_KEY: string;
}

export const appConfig = () => {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  };
};
