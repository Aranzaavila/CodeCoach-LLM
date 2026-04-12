import os
os.environ["UNSLOTH_SKIP_TORCHVISION_CHECK"] = "1"

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from scripts.inference import ask_codecoach

app = FastAPI()

# Allow React frontend to talk to this server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class Question(BaseModel):
    message: str

@app.get("/")
def root():
    return {"status": "CodeCoach API is running"}

@app.post("/chat")
def chat(question: Question):
    response = ask_codecoach(question.message)
    return {"response": response}