from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    database_url: str = "sqlite:///./inventory.db"
    secret_key: str = "change-this-to-a-secure-random-key"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480

    @field_validator("secret_key")
    @classmethod
    def check_secret(cls, v: str) -> str:
        if "change-this-to-a-secure-random-key" in v:
            raise ValueError("secret_key must be replaced with a unique random value via .env or environment variable")
        if len(v) < 32:
            raise ValueError("secret_key must be at least 32 characters")
        return v


settings = Settings()
