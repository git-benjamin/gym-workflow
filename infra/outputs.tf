output "cloudflare_worker_name" {
  description = "Worker name. Webhook URL: https://{worker-name}.{account-subdomain}.workers.dev — find your subdomain at dash.cloudflare.com > Workers & Pages > Overview"
  value       = cloudflare_workers_script.hevy_webhook.name
}
