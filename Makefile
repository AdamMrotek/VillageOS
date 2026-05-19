.PHONY: frontend backend be-reload docker seed

frontend:
	cd apps/web && pnpm dev

backend:
	cd apps/api && . .venv/bin/activate && uvicorn main:app --reload

be-reload:
	-lsof -ti :8000 | xargs kill -9 2>/dev/null || true
	cd apps/api && . .venv/bin/activate && uvicorn main:app --reload
