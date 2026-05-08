.PHONY: frontend backend docker seed

frontend:
	cd apps/web && pnpm dev

backend:
	cd apps/api && uvicorn main:app --reload
