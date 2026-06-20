locals {
  github_secrets = {
    HEVY_API_KEY         = var.hevy_api_key
    SUPABASE_URL         = var.supabase_url
    SUPABASE_KEY         = var.supabase_service_key
    SUPABASE_BUCKET      = var.supabase_bucket
    SUPABASE_S3_ENDPOINT = var.supabase_s3_endpoint
    SUPABASE_S3_KEY      = var.supabase_s3_key
    SUPABASE_S3_SECRET   = var.supabase_s3_secret
    SUPABASE_S3_REGION   = var.supabase_s3_region
    GEMINI_API_KEY       = var.gemini_api_key
  }
}

resource "github_actions_secret" "hevy_analytics" {
  for_each = local.github_secrets

  repository      = var.github_repo
  secret_name     = each.key
  value = each.value
}
