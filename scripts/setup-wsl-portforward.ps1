# WSL2 Port Forwarding Script for Skip-Bo Game
# Run this in PowerShell as Administrator on Windows

$wslIP = bash.exe -c "hostname -I | awk '{print `$1}'"
$wslIP = $wslIP.Trim()

Write-Host "WSL2 IP Address: $wslIP"
Write-Host "Windows Host IP: 192.168.1.184"
Write-Host ""

# Remove existing port forwarding rules if they exist
Write-Host "Removing existing port forwarding rules..."
netsh interface portproxy delete v4tov4 listenport=3001 listenaddress=0.0.0.0 | Out-Null
netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0 | Out-Null

# Add port forwarding rules
Write-Host "Adding port forwarding rules..."
netsh interface portproxy add v4tov4 listenport=3001 listenaddress=0.0.0.0 connectport=3001 connectaddress=$wslIP
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=$wslIP

# Configure Windows Firewall
Write-Host ""
Write-Host "Configuring Windows Firewall..."
netsh advfirewall firewall delete rule name="Skip-Bo Server" | Out-Null
netsh advfirewall firewall delete rule name="Skip-Bo Client" | Out-Null
netsh advfirewall firewall add rule name="Skip-Bo Server" dir=in action=allow protocol=TCP localport=3001
netsh advfirewall firewall add rule name="Skip-Bo Client" dir=in action=allow protocol=TCP localport=3000

# Display current port forwarding rules
Write-Host ""
Write-Host "Current Port Forwarding Rules:"
netsh interface portproxy show v4tov4

Write-Host ""
Write-Host "Setup complete!"
Write-Host ""
Write-Host "Your game will be accessible at:"
Write-Host "  http://192.168.1.184:3000"
Write-Host ""
Write-Host "To remove port forwarding later, run:"
Write-Host "  netsh interface portproxy reset"
