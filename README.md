# Builder

A phone-friendly inbox for the AI coding agents running in [herdr](https://herdr.dev) on a home server.
Every agent that is blocked or finished shows up; you answer from your phone and the answer is typed
into that exact agent's terminal. Agents can also send you three design mockups to swipe through, or a
screenshot of the finished change to approve (merge into `dev`) or deny with what to change.

- No dependencies: Node 22 standard library only.
- Access over Tailscale only. Users are identified by their Tailscale login: `OWNER` can answer and
  approve; everyone else can view and comment.
- Before typing into a pane it re-checks that the same agent is still there and not busy.

## Run

```sh
cp .env.example .env        # set OWNER and TAILNET_IP
node --env-file=.env server.js
# or as a user service:
ln -s "$PWD/builder.service" ~/.config/systemd/user/ && systemctl --user enable --now builder
```

Open `http://<TAILNET_IP>:8740` from any device on your tailnet.

## Agents

Plain questions need nothing: the inbox shows the pane's last lines. For mockups and reviews,
agents follow [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) (also packaged as the `skills/builder-request` skill).

## Test

```sh
node --test
```
