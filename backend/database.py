from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = "sqlite:///./backtest.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_columns() -> None:
    """모델에 새로 생긴 컬럼을 기존 테이블에 더한다.

    이 프로젝트에는 마이그레이션 도구가 없고 create_all은 이미 존재하는 테이블을
    건드리지 않는다. 그래서 컬럼을 추가하면 예전 DB를 쓰던 쪽에서 조회가 깨진다.
    SQLite의 ADD COLUMN은 되돌릴 필요가 없는 덧붙이기라 시작할 때마다 안전하게
    돌릴 수 있다. 컬럼 삭제나 타입 변경은 여기서 다루지 않는다.
    """
    from sqlalchemy import inspect, text

    wanted = {
        "companies": {"sector": "VARCHAR", "industry": "VARCHAR", "industry_krx": "VARCHAR"},
    }
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table, columns in wanted.items():
            if table not in existing_tables:
                continue  # create_all이 방금 스키마대로 만들었다
            have = {c["name"] for c in inspector.get_columns(table)}
            for name, sql_type in columns.items():
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))
