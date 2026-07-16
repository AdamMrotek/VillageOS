.PHONY: frontend admin backend be-reload docker seed eval e2e e2e-headed e2e-report

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

# Full e2e run: local Supabase stack up → DB reset to seeded state → Playwright.
# Next 16 allows one dev server per app dir, so any running `make frontend` is
# stopped first (Playwright boots its own web server on :3100).
# Iterating on specs with the stack already seeded? `pnpm --filter @repo/e2e test`
# alone skips the reset.
e2e:
	@supabase status >/dev/null 2>&1 || supabase start -x studio,imgproxy,edge-runtime,vector,logflare
	@supabase db reset
	-@lsof -ti :3000,3100,8100 | xargs kill 2>/dev/null || true
	pnpm --filter @repo/e2e test

# Same, but with visible browser windows for debugging.
e2e-headed:
	@supabase status >/dev/null 2>&1 || supabase start -x studio,imgproxy,edge-runtime,vector,logflare
	@supabase db reset
	-@lsof -ti :3000,3100,8100 | xargs kill 2>/dev/null || true
	pnpm --filter @repo/e2e exec playwright test --headed

# Open the HTML report from the last run.
e2e-report:
	pnpm --filter @repo/e2e report
