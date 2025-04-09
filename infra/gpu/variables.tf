variable "do_token" {
  description = "DigitalOcean API Token"
  type        = string
  sensitive   = true
}

variable "ssh_key_name" {
  description = "Name of your existing SSH key in DigitalOcean"
  type        = string
}

variable "region" {
  description = "DigitalOcean region"
  type        = string
  default     = "nyc1"  # Choose your preferred region
}

variable "vpn_port" {
  description = "Port for WireGuard VPN"
  type        = number
  default     = 51820
}