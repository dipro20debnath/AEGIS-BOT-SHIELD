# Aegis Bot Shield - Python SDK

The Aegis Python SDK provides middleware for integrating the Aegis Bot Shield into Python web applications.

## Features
- Framework-agnostic core
- Middleware for Django, Flask, and FastAPI/Starlette
- High-performance token verification (HMAC-SHA256)
- IP binding and replay protection

## Usage (FastAPI)

```python
from fastapi import FastAPI
from aegis import AegisFastAPIMiddleware, AegisConfig, ProtectionMode

app = FastAPI()

config = AegisConfig(
    secret_key="your_secure_secret_key",
    protection_mode=ProtectionMode.ENFORCE
)

app.add_middleware(AegisFastAPIMiddleware, config=config)

@app.get("/")
def read_root():
    return {"message": "Hello World. You are protected by Aegis!"}
```
