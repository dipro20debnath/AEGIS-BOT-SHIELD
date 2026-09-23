import os
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
# In a real project: from aegis_python.fastapi import AegisMiddleware
import sys
sys.path.append('../../packages/aegis-python')
from aegis_fastapi import AegisMiddleware, aegis_protect

app = FastAPI(title="AEGIS BOT SHIELD - FastAPI Example")

# Add AEGIS Middleware globally
app.add_middleware(
    AegisMiddleware,
    secret_key=os.getenv("AEGIS_SECRET_KEY", "dev-secret-key-123"),
    action_on_bot="block",  # Automatically return 403 for bots
    exempt_paths=["/docs", "/openapi.json", "/health"]
)

class LoginRequest(BaseModel):
    username: str
    password: str

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.post("/api/login")
async def login(credentials: LoginRequest, request: Request):
    """
    Login endpoint. 
    Because middleware is added globally, this route is automatically protected.
    Only human traffic will reach this function.
    """
    if credentials.username == "admin" and credentials.password == "password":
        return {"success": True, "message": "Welcome, verified human!"}
    
    raise HTTPException(status_code=401, detail="Invalid credentials")

@app.get("/api/secure-data")
# Explicit dependency injection approach if not using global middleware
async def get_secure_data(is_human: bool = Depends(aegis_protect)):
    return {
        "message": "Highly sensitive data",
        "verified_by_aegis": True
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
