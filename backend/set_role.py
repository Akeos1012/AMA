import firebase_admin
from firebase_admin import credentials, auth

cred = credentials.Certificate("firebase-service-account.json")

if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)

users = {
    "student@test.com": "student",
    "teacher@test.com": "teacher",
    "admin@test.com": "admin"
}

for email, role in users.items():
    user = auth.get_user_by_email(email)

    auth.set_custom_user_claims(user.uid, {
        "role": role
    })

    print(f"Assigned role={role} to {email}")