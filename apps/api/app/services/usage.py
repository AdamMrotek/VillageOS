from supabase import Client


def bump_usage(admin_db: Client, user_id: str) -> int:
    """Atomically increment today's usage counter for a user; return the new total.

    Delegates to the `bump_usage` SQL function (a single INSERT ... ON CONFLICT
    ... DO UPDATE ... RETURNING) so two concurrent Lambdas can't both pass the
    cap. Must be called with the service-role client (`get_admin_db`) — the
    function is REVOKEd from the anon/authenticated roles.

    Increment-on-attempt is deliberate: a caller hammering a 429 keeps getting
    rejected instead of slipping through, and the LLM never fires for an
    over-budget request.
    """
    result = admin_db.rpc("bump_usage", {"p_user_id": user_id}).execute()
    return result.data
