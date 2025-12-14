import requests
import sys

try:
    print("Testing OPTIONS request...")
    r = requests.options("http://127.0.0.1:8088")
    print(f"Status: {r.status_code}")
    print("Headers:", r.headers)
    
    print("\nTesting POST request...")
    r = requests.post("http://127.0.0.1:8088", json={"text": "test"})
    print(f"Status: {r.status_code}")
    print("Headers:", r.headers)
    print("Response:", r.text)
except Exception as e:
    print(f"Error: {e}")
