terraform {
  required_version = ">= 1.6"

  # State stored in Supabase Storage (S3-compatible) — same infra as workout Parquet.
  # Before first `terraform init`, create a bucket named "terraform-state" in Supabase
  # Storage dashboard (one-time manual step — can't bootstrap with Terraform itself).
  # Then set env vars or fill in the values below from Project Settings > Storage > S3.
  backend "s3" {
    bucket = "terraform-state"
    key    = "gym-workflow/terraform.tfstate"
    region = "ap-southeast-2"  # your Supabase project region

    # Supabase S3 endpoint — from Storage > S3 Connection in Supabase dashboard
    # Format: {ref}.supabase.co/storage/v1/s3  (no https://)
    endpoints = {
      s3 = "https://{ref}.supabase.co/storage/v1/s3"
    }

    # Credentials from Storage > S3 Connection
    access_key = "your-s3-access-key-id"
    secret_key = "your-s3-secret"

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    force_path_style            = true
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "github" {
  token = var.github_token
  owner = var.github_owner
}
