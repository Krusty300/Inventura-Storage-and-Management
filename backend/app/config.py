from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./inventory.db"
    secret_key: str = "change-this-to-a-secure-random-key"
    previous_secret_keys: str = ""
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    remember_token_expire_minutes: int = 43200
    key_rotation_grace_hours: int = 72

    @field_validator("secret_key")
    @classmethod
    def check_secret(cls, v: str) -> str:
        if "change-this-to-a-secure-random-key" in v:
            raise ValueError("secret_key must be replaced with a unique random value via .env or environment variable")
        if len(v) < 32:
            raise ValueError("secret_key must be at least 32 characters")
        return v

    @property
    def all_valid_keys(self) -> list[str]:
        """Return current key plus recent previous keys still within grace period.

        New tokens are always signed with ``secret_key``. When verifying, the
        system tries each key from most-recent to oldest so that tokens signed
        with a recently-rotated key are still accepted during the grace window.
        """
        keys = [self.secret_key]
        if self.previous_secret_keys:
            for old_key in self.previous_secret_keys.split(","):
                old_key = old_key.strip()
                if old_key and len(old_key) >= 32:
                    keys.append(old_key)
        return keys


settings = Settings()
