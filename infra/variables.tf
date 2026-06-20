variable "supabase_db_url" {
  description = "Supabase PostgreSQL connection string — get from Project Settings > Database > Connection string (URI format)"
  type        = string
  sensitive   = true
}

variable "supabase_management_token" {
  description = "Supabase personal access token — from supabase.com/dashboard/account/tokens"
  type        = string
  sensitive   = true
}

variable "supabase_url" {
  description = "Supabase project URL (e.g. https://<ref>.supabase.co)"
  type        = string
}

variable "supabase_service_key" {
  description = "Supabase service role API key"
  type        = string
  sensitive   = true
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Workers:Edit permission"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "hevy_webhook_auth" {
  description = "Secret value for the Authorization header Hevy sends to the Worker"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "GitHub PAT with repo + workflow scopes (for Terraform + repository_dispatch)"
  type        = string
  sensitive   = true
}

variable "github_owner" {
  description = "GitHub username / org that owns the repo"
  type        = string
}

variable "github_repo" {
  description = "GitHub repo name (without owner prefix)"
  type        = string
}

variable "hevy_api_key" {
  description = "Hevy API key"
  type        = string
  sensitive   = true
}

variable "supabase_bucket" {
  description = "Supabase Storage bucket name"
  type        = string
  default     = "hevy-analytics"
}

variable "supabase_s3_endpoint" {
  description = "Supabase Storage S3-compatible endpoint"
  type        = string
}

variable "supabase_s3_key" {
  description = "Supabase Storage S3 access key ID"
  type        = string
  sensitive   = true
}

variable "supabase_s3_secret" {
  description = "Supabase Storage S3 secret access key"
  type        = string
  sensitive   = true
}

variable "supabase_s3_region" {
  description = "Supabase Storage S3 region (e.g. ap-southeast-2)"
  type        = string
  default     = "ap-southeast-2"
}

variable "anthropic_api_key" {
  description = "Anthropic API key for Claude Haiku"
  type        = string
  sensitive   = true
}
