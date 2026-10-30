# Reading a login code over SSH (registration and first-login testing)

`ops/otp-reveal.sh` prints the newest login code the API logged for one merchant user. It is for
testing registration on the hosted box. Nothing else should use it.

## How it stays narrow

- The API logs a code only for accounts on `OTP_LOG_MERCHANT_EMAILS` or `OTP_LOG_MERCHANT_USER_IDS`, and only
  when `OTP_LOG_CODE=true` in production. Accounts not on a list never get their code logged.
- The script accepts one value, validated as a plain email address. Anything else exits before Docker runs.
- The SSH key is restricted to running the script, so it cannot open a shell.

## Setup on the server (not yet done)

1. Copy the script to `/usr/local/bin/otp-reveal` (root-owned, mode 755, not writable by the deploy user).
2. In `~/fils-pay/ops/.env.prod` set:
   `OTP_LOG_CODE=true` and `OTP_LOG_MERCHANT_EMAILS=<the address(es) being tested>`, then recreate the api:
   `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d api`
3. Add the key to `~/.ssh/authorized_keys` with a forced command:
   `command="/usr/local/bin/otp-reveal",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding <key>`
4. Reading a code: `ssh -i <key> dilmune@<server> <email>`. Prints the code, or an error.

## Things to know

- The script needs Docker access. Give it a sudoers rule that allows only this script, not a general docker
  or sudo grant, or the key can read every log.
- Codes stay in the container log until it rotates. Clear the log after testing, or remove the email from the
  list and restart the API when you're finished.
- `dcs-promtail` runs on the box. Check where it sends logs before enabling `OTP_LOG_CODE`, because a shipped
  copy of the log holds every code.
- If the same email is registered under two merchants, the script picks the most recent account.
