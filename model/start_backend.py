#!/usr/bin/env python3
"""
Sugar Sense AI Backend Startup Script
Provides network information and starts the Flask server with optimal configuration
"""

import os
import sys
import subprocess
import socket
import platform
from pathlib import Path

def check_python_version():
    """Check if Python version is suitable"""
    version = sys.version_info
    if version < (3, 8):
        print("❌ Python 3.8+ required. Current version:", f"{version.major}.{version.minor}.{version.micro}")
        return False
    print(f"✅ Python version: {version.major}.{version.minor}.{version.micro}")
    return True

def check_virtual_environment():
    """Check if running in virtual environment"""
    in_venv = hasattr(sys, 'real_prefix') or (hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix)
    if in_venv:
        print(f"✅ Virtual environment: {sys.prefix}")
    else:
        print("⚠️  Not in virtual environment (recommended to use venv)")
    return in_venv

def check_requirements():
    """Check if required packages are installed"""
    required_packages = ['flask', 'sqlite3', 'requests']
    missing_packages = []
    
    for package in required_packages:
        try:
            __import__(package)
            print(f"✅ {package} installed")
        except ImportError:
            missing_packages.append(package)
            print(f"❌ {package} missing")
    
    if missing_packages:
        print(f"\n📦 Install missing packages with:")
        print(f"pip install {' '.join(missing_packages)}")
        return False
    
    return True

def get_network_info():
    """Get comprehensive network information"""
    hostname = socket.gethostname()
    network_ips = []
    
    try:
        ip_list = socket.getaddrinfo(hostname, None)
        for ip_info in ip_list:
            ip = ip_info[4][0]
            if not ip.startswith('127.') and ':' not in ip and ip not in network_ips:
                network_ips.append(ip)
    except Exception:
        pass
    
    return {
        'hostname': hostname,
        'platform': platform.system(),
        'network_ips': sorted(network_ips)
    }

def print_startup_banner():
    """Print startup banner with network information"""
    info = get_network_info()
    port = 3001
    
    print("\n" + "🌟" * 40)
    print("🍭 SUGAR SENSE AI - BACKEND SERVER")
    print("🌟" * 40)
    print(f"🖥️  Hostname: {info['hostname']}")
    print(f"💻 Platform: {info['platform']}")
    print(f"🔌 Port: {port}")
    print(f"🌐 Binding: 0.0.0.0 (all network interfaces)")
    
    print(f"\n📡 YOUR BACKEND IS ACCESSIBLE AT:")
    print("-" * 50)
    
    # Localhost URLs
    print("🏠 Localhost (same computer):")
    print(f"   • http://localhost:{port}")
    print(f"   • http://127.0.0.1:{port}")
    
    # Network URLs for mobile devices
    if info['network_ips']:
        print(f"\n📱 Network (mobile devices & other computers):")
        for ip in info['network_ips']:
            print(f"   • http://{ip}:{port}")
    else:
        print(f"\n⚠️  No network IPs detected. Check WiFi connection.")
    
    print(f"\n🔧 SETUP INSTRUCTIONS:")
    print("-" * 25)
    print("1. Keep this terminal window open")
    print("2. Your mobile app will automatically find the backend")
    print("3. Ensure mobile device is on the same WiFi network")
    
    if info['network_ips']:
        print(f"\n📋 MOBILE APP CONFIG (if needed):")
        print("Your mobile app will try these URLs automatically:")
        for ip in info['network_ips'][:3]:
            print(f"   {ip}:{port}")
    
    print("\n" + "🌟" * 40)

def check_port_availability(port=3001):
    """Check if the port is available"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(('localhost', port))
        sock.close()
        print(f"✅ Port {port} is available")
        return True
    except OSError:
        print(f"❌ Port {port} is already in use")
        return False

def main():
    """Main startup function"""
    print("🔍 CHECKING SYSTEM REQUIREMENTS...")
    print("-" * 40)
    
    # System checks
    if not check_python_version():
        sys.exit(1)
    
    check_virtual_environment()
    
    if not check_requirements():
        print("\n❌ Missing requirements. Please install them first.")
        sys.exit(1)
    
    if not check_port_availability():
        print("❌ Port 3001 is busy. Stop other servers or change port.")
        sys.exit(1)
    
    print("\n✅ All system checks passed!")
    
    # Print network information
    print_startup_banner()
    
    print("\n🚀 STARTING FLASK SERVER...")
    print("Press Ctrl+C to stop the server")
    print("-" * 40)
    
    # Change to the model directory
    os.chdir(Path(__file__).parent)
    
    # Start the Flask app
    try:
        subprocess.run([sys.executable, 'app.py'], check=True)
    except KeyboardInterrupt:
        print("\n\n👋 Server stopped by user")
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Error starting server: {e}")
    except FileNotFoundError:
        print("\n❌ app.py not found. Make sure you're in the correct directory.")

if __name__ == "__main__":
    main() 