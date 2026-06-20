output "cloudflare_worker_name" {
  description = "Cloudflare Worker name — configure this as the webhook URL in Hevy"
  value       = cloudflare_worker_script.hevy_webhook.name
}
