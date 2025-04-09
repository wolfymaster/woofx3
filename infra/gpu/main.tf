# Configure the DigitalOcean Provider
terraform {
  required_providers {
    digitalocean = {
      source = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

# Set the DigitalOcean API token
provider "digitalocean" {
  token = var.do_token
}

# Fetch existing SSH key
data "digitalocean_ssh_key" "existing" {
  name = var.ssh_key_name
}

# Create a GPU Droplet
resource "digitalocean_droplet" "gpu_droplet" {
  name      = "gpu-ollama-server"
  size      = "gpu-h100x1-80gb"
  image     = "ubuntu-22-04-x64"
  region    = var.region
  ssh_keys  = [data.digitalocean_ssh_key.existing.id]
  
  # Install essential packages, create user, and setup Ollama via cloud-init
  user_data = templatefile("${path.module}/cloud-init.tftpl", {
    vpn_port = var.vpn_port
  })  

  # Ensure we can connect via SSH before moving on
  provisioner "remote-exec" {
    inline = ["echo 'Droplet is ready and accessible'"]
    
    connection {
      host        = self.ipv4_address
      type        = "ssh"
      user        = "wolfy"  # Connect as wolfy instead of root
      private_key = file("~/.ssh/id_rsa")
    }
  }
}

# Output important information
output "droplet_ip" {
  value = digitalocean_droplet.gpu_droplet.ipv4_address
  description = "Public IP address of the GPU droplet"
}

output "ssh_command" {
  value = "ssh wolfy@${digitalocean_droplet.gpu_droplet.ipv4_address}"
  description = "Command to SSH into the droplet as wolfy user"
}

output "vpn_connection_command" {
  value = "ssh wolfy@${digitalocean_droplet.gpu_droplet.ipv4_address} 'cat ~/wireguard-client.conf' > wireguard-client.conf"
  description = "Command to fetch WireGuard client configuration"
}

output "ollama_api_endpoint" {
  value = "http://${digitalocean_droplet.gpu_droplet.ipv4_address}:11434/api"
  description = "Ollama API endpoint (accessible after connecting to VPN)"
}