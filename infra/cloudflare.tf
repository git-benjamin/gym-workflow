resource "cloudflare_worker_script" "hevy_webhook" {
  account_id = var.cloudflare_account_id
  name       = "hevy-webhook"
  content    = file("${path.module}/../cloudflare/hevy-webhook/worker.js")

  plain_text_binding {
    name = "GH_REPO"
    text = "${var.github_owner}/${var.github_repo}"
  }

  secret_text_binding {
    name = "HEVY_WEBHOOK_AUTH"
    text = var.hevy_webhook_auth
  }

  secret_text_binding {
    name = "GH_PAT"
    text = var.github_token
  }
}

resource "cloudflare_worker_domain" "hevy_webhook" {
  account_id = var.cloudflare_account_id
  hostname   = "hevy-webhook.workers.dev"
  service    = cloudflare_worker_script.hevy_webhook.name

  lifecycle {
    ignore_changes = [hostname]
  }
}
