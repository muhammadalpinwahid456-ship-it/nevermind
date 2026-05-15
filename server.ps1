# Simple HTTP Server untuk development
$port = 8000
$docroot = (Get-Location).Path

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host "[OK] Server started at http://localhost:$port/" -ForegroundColor Green
Write-Host "[OK] Document root: $docroot" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow

try {
    while ($true) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $url = $request.Url.LocalPath
        if ($url -eq "/") { $url = "/index.html" }
        
        $filepath = Join-Path $docroot $url.TrimStart("/")
        
        Write-Host "[REQUEST] $url" -ForegroundColor Cyan
        
        if (Test-Path $filepath -PathType Leaf) {
            $response.StatusCode = 200
            
            # Set Content-Type
            $ext = [System.IO.Path]::GetExtension($filepath)
            $contentTypes = @{
                ".html" = "text/html; charset=utf-8"
                ".css"  = "text/css; charset=utf-8"
                ".js"   = "application/javascript; charset=utf-8"
                ".json" = "application/json; charset=utf-8"
                ".png"  = "image/png"
                ".jpg"  = "image/jpeg"
                ".jpeg" = "image/jpeg"
                ".gif"  = "image/gif"
                ".svg"  = "image/svg+xml"
                ".webp" = "image/webp"
                ".mp4"  = "video/mp4"
                ".webm" = "video/webm"
            }
            
            $response.ContentType = if ($contentTypes.ContainsKey($ext)) { $contentTypes[$ext] } else { "application/octet-stream" }
            
            $buffer = [System.IO.File]::ReadAllBytes($filepath)
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
        } else {
            $response.StatusCode = 404
            $response.ContentType = "text/html; charset=utf-8"
            $html = "<h1>404 Not Found</h1><p>$url</p>"
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($html)
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
        }
        
        $response.OutputStream.Close()
    }
} finally {
    $listener.Stop()
    Write-Host "[OK] Server stopped" -ForegroundColor Green
}
