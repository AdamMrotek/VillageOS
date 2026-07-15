.PHONY: frontend admin backend be-reload docker seed eval

frontend:
	cd apps/web && pnpm dev

admin:
	cd apps/admin && pnpm dev

backend:
	cd apps/api && . .venv/bin/activate && uvicorn main:app --reload

be-reload:
	-lsof -ti :8000 | xargs kill -9 2>/dev/null || true
	cd apps/api && . .venv/bin/activate && uvicorn main:app --reload

eval:
	@echo "Eval results + golden set now live in the admin app at /evals and /golden."
	cd apps/admin && pnpm dev
