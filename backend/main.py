import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from routers import stocks, strategies, backtests, screening

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Stock Backtesting API", version="1.0.0")

# CORS for React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stocks.router)
app.include_router(strategies.router)
app.include_router(backtests.router)
app.include_router(screening.router)


@app.get("/")
def root():
    return {"message": "Stock Backtesting API is running"}
