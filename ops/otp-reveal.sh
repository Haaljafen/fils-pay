#!/usr/bin/env bash
# Prints the newest login code the API logged for one merchant user, for registration and first-login testing.
#
# Reached only through an SSH key with a forced command (see ops/otp-reveal.README.md), which runs this script
# and nothing else. Usage: otp-reveal.sh <email>   (or SSH_ORIGINAL_COMMAND="<email>" when forced)
#
# Environment overrides exist so the script can be tested without Docker:
#   OTP_REVEAL_DOCKER   docker binary (default: docker)
#   OTP_REVEAL_PG       postgres container (default: filspay-postgres-1)
#   OTP_REVEAL_API      api container (default: filspay-api-1)
set -euo pipefail

DOCKER="${OTP_REVEAL_DOCKER:-docker}"
PG="${OTP_REVEAL_PG:-filspay-postgres-1}"
API="${OTP_REVEAL_API:-filspay-api-1}"

email="${1:-${SSH_ORIGINAL_COMMAND:-}}"
# Trim the ends only: a space inside the value must fail the check below, not be silently removed.
email="$(printf '%s' "$email" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

# Strict shape check: the value is later placed in a SQL literal, so anything beyond a plain address is refused.
if ! [[ "$email" =~ ^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$ ]]; then
  echo "refused: expected an email address" >&2
  exit 2
fi
lower="$(printf '%s' "$email" | tr '[:upper:]' '[:lower:]')"

# Read-only lookup of the user id. The email is already validated, so it cannot break out of the literal.
uid="$("$DOCKER" exec -i "$PG" psql -U filspay -d filspay -tA \
  -c "SELECT id FROM merchant_users WHERE lower(email) = '$lower' ORDER BY created_at DESC LIMIT 1" 2>/dev/null | tr -d '[:space:]' || true)"

if [[ -z "$uid" ]]; then
  echo "no merchant user with that email (or the account has not been created yet)" >&2
  exit 1
fi

# The API writes "otp code generated (allowlisted operator log)" with merchantUserId and code as JSON fields.
# Take the newest match and print only the code.
code="$("$DOCKER" logs "$API" 2>&1 \
  | grep '"msg":"otp code generated (allowlisted operator log)"' \
  | grep "\"merchantUserId\":\"$uid\"" \
  | tail -n 1 \
  | sed -n 's/.*"code":"\([0-9]*\)".*/\1/p' || true)"

if [[ -z "$code" ]]; then
  echo "no code logged for that user yet: check the email is on OTP_LOG_MERCHANT_EMAILS and that the API was restarted after the change" >&2
  exit 1
fi

echo "$code"
