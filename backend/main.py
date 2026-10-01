import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base, ensure_columns
from routers import stocks, strategies, backtests, screening, macro, snapshots, industry, reports, signals

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# Create tables
Base.metadata.create_all(bind=engine)
ensure_columns()

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
app.include_router(macro.router)
app.include_router(snapshots.router)
app.include_router(industry.router)
app.include_router(reports.router)
app.include_router(signals.router)


@app.get("/")
def root():
    return {"message": "Stock Backtesting API is running"}
