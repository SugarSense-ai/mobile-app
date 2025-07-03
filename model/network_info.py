#!/usr/bin/env python3
"""
Network Information Helper for Flask Backend
Shows all available IP addresses where the Flask app can be accessed
"""

import socket
import subprocess
import platform
import sys

def get_local_ip_addresses():
    """Get all local IP addresses"""
    ip_addresses = []
    
    try:
        # Get hostname
        hostname = socket.gethostname()
        
        # Get all IP addresses associated with the hostname
        ip_list = socket.getaddrinfo(hostname, None)
        
        for ip_info in ip_list:
            ip = ip_info[4][0]
            if ip not in ip_addresses and not ip.startswith('127.') and ':' not in ip:
                ip_addresses.append(ip)
    except Exception as e:
        print(f"Error getting IP addresses: {e}")
    
    return ip_addresses

def get_network_interfaces():
    """Get network interface information"""
    interfaces = []
    
    try:
        if platform.system() == "Darwin":  # macOS
            result = subprocess.run(['ifconfig'], capture_output=True, text=True)
            lines = result.stdout.split('\n')
            
            current_interface = None
            for line in lines:
                if line and not line.startswith('\t') and not line.startswith(' '):
                    current_interface = line.split(':')[0]
                elif 'inet ' in line and current_interface:
                    ip = line.split('inet ')[1].split(' ')[0]
                    if not ip.startswith('127.') and '.' in ip:
                        interfaces.append({
                            'interface': current_interface,
                            'ip': ip
                        })
        
        elif platform.system() == "Linux":
            result = subprocess.run(['ip', 'addr', 'show'], capture_output=True, text=True)
            # Parse Linux ip command output (simplified)
            lines = result.stdout.split('\n')
            for line in lines:
                if 'inet ' in line and not '127.0.0.1' in line:
                    ip = line.split('inet ')[1].split('/')[0].strip()
                    interfaces.append({
                        'interface': 'network',
                        'ip': ip
                    })
    
    except Exception as e:
        print(f"Error getting network interfaces: {e}")
    
    return interfaces

def print_network_info(port=3001):
    """Print comprehensive network information"""
    print("=" * 60)
    print("🌐 FLASK BACKEND NETWORK INFORMATION")
    print("=" * 60)
    
    # Basic info
    print(f"🖥️  Hostname: {socket.gethostname()}")
    print(f"🔌 Port: {port}")
    print(f"💻 Platform: {platform.system()} {platform.release()}")
    
    # IP Addresses
    print("\n📡 AVAILABLE IP ADDRESSES:")
    print("-" * 30)
    
    # Localhost
    print("🏠 Localhost URLs (for same machine):")
    print(f"   • http://localhost:{port}")
    print(f"   • http://127.0.0.1:{port}")
    
    # Network IPs
    ip_addresses = get_local_ip_addresses()
    interfaces = get_network_interfaces()
    
    all_ips = set(ip_addresses)
    for interface in interfaces:
        all_ips.add(interface['ip'])
    
    if all_ips:
        print(f"\n🌍 Network URLs (for mobile device/other computers):")
        for ip in sorted(all_ips):
            print(f"   • http://{ip}:{port}")
    
    # Network interface details
    if interfaces:
        print(f"\n🔌 NETWORK INTERFACES:")
        print("-" * 30)
        for interface in interfaces:
            print(f"   {interface['interface']}: {interface['ip']}")
    
    # Mobile app configuration
    print(f"\n📱 FOR MOBILE APP CONFIGURATION:")
    print("-" * 40)
    print("Add these URLs to your mobile app's fallback list:")
    
    config_urls = [f"http://localhost:{port}", f"http://127.0.0.1:{port}"]
    for ip in sorted(all_ips):
        config_urls.append(f"http://{ip}:{port}")
    
    for i, url in enumerate(config_urls[:5]):  # Show first 5
        print(f"   '{url}',")
    
    # Troubleshooting
    print(f"\n🔧 TROUBLESHOOTING:")
    print("-" * 20)
    print("If mobile app can't connect:")
    print("1. Ensure both devices are on the same WiFi network")
    print("2. Check if firewall is blocking port 3001")
    print("3. Try restarting the Flask server")
    print("4. Verify the mobile app is using one of the URLs above")
    
    print("\n" + "=" * 60)

def main():
    """Main function"""
    port = 3001
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("Invalid port number, using default 3001")
    
    print_network_info(port)

if __name__ == "__main__":
    main() 