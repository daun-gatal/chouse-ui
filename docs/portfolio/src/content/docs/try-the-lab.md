# Try the lab

The lab is a private copy of CHouse UI that runs in **your own GitHub
Codespace**. It comes with a ClickHouse server, sample data and example
content in every area, so you can try everything as admin before you install
anything.

[Open the lab in GitHub Codespaces](https://codespaces.new/daun-gatal/chouse-ui?devcontainer_path=.devcontainer%2Flab%2Fdevcontainer.json&quickstart=1)

## What you need, and what it costs

- **A GitHub account.** The codespace runs in your account. There is no hosted
  demo and no sign-up with us.
- **About 3 minutes** for the first start, while the codespace pulls the
  images and loads the data.
- **Some of your free Codespaces quota.** Personal GitHub accounts include
  free monthly compute and storage. The lab uses the 2-core machine, which
  spends 2 core-hours of that quota per hour it runs. GitHub doesn't charge
  you past your spending limit, which is $0 unless you raised it. See
  [GitHub's Codespaces billing page](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-codespaces/about-billing-for-github-codespaces)
  for the current allowance.
- **Optionally, your own AI key.** It is needed only for the AI features (see
  below), and billed to you by your provider.

Only you can open your lab. Its forwarded address needs your GitHub sign-in,
and its admin password and secrets are generated for that one codespace.

## What's inside

Each codespace runs the published CHouse UI image, one ClickHouse server, a
light query load and a one-off loader. The loader fills:

| Area | What you'll find |
|---|---|
| **SQL workspace** | `shop` and `analytics` databases with 2 million orders, a materialized view, a small `finance` database, and four shared saved queries. |
| **Monitoring** | A steady query load, new orders every 30 seconds, one slow query every 2 minutes and one failing query every 10 minutes. |
| **Dashboards** | *Shop sales*, and the *ClickHouse overview*, *Query latency* and *Disk and tables* templates. |
| **Data** | Two data-health promises. One holds; *Shop orders are in EUR* breaks on purpose, so there is an incident to investigate. |
| **Alerts and schedules** | A fleet threshold rule and a daily report that has already run once. |
| **Access control** | Teammates `maya` (analyst), `devon` (developer) and `vic` (viewer), and a data access policy that limits analysts to the sample databases. |
| **Context** | Descriptions, owners and a `revenue` metric for the sample tables. |

The in-app **Getting Started** guide opens on first sign-in and walks through
every area. The codespace also opens a short guide, `WELCOME.md`, with things
to try.

## Sign in

When the lab is ready, the terminal prints the address and a password made
for that lab:

```text
CHouse UI lab is ready.
  Open:     https://<your-codespace>-5521.app.github.dev
  Sign in:  admin / Lab-…-Ch1!
            teammates maya (analyst), devon (developer) and vic (viewer) use the same password
```

The browser tab opens on its own. If a popup blocker stops it, open the
**Ports** panel and click the globe icon next to **CHouse UI (5521)**. The
sign-in is also saved in `.devcontainer/lab/.state/login.txt`.

## Turn on AI

The AI SRE, *Optimize with AI*, Chobi and chat need a model. The lab uses your
own key:

1. Add a Codespaces secret named `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in
   [your Codespaces settings](https://github.com/settings/codespaces), with
   access to `daun-gatal/chouse-ui`. If you already have one with that name,
   the lab finds it.
2. Create the codespace, or rebuild it (<kbd>F1</kbd> › **Codespaces: Rebuild
   Container**).

The lab registers the key as the default model: Claude Haiku for Anthropic,
or GPT-5 mini for OpenAI. Anthropic is used when both are set. You can change
the model under **Admin › AI models**.

## When you're done

A codespace stops after 30 minutes without activity. That is a setting in
your GitHub account, not part of the lab. A stopped codespace still counts
against your storage until it is deleted. Delete it at
[github.com/codespaces](https://github.com/codespaces), or let GitHub remove
it after your retention period (30 days by default). Deleting it removes
everything, including any key you added to the lab.

## Run the lab without Codespaces

The lab is a Docker Compose stack, so it also runs on any machine with
Docker:

```bash
git clone https://github.com/daun-gatal/chouse-ui.git
cd chouse-ui
bash .devcontainer/lab/up.sh
```

Open <http://localhost:5521>. If you open it from another machine, set
`LAB_URL` to the address your browser uses (for example
`LAB_URL=http://my-vm:5521 bash .devcontainer/lab/up.sh`). Remove it with
`docker compose -p chouse-lab down -v`.

The lab is for trying CHouse UI, not for running it. To install it for your
team, start with the [quick start](/docs/quick-start/).
