from flask import Flask, request, render_template, redirect, url_for, session, jsonify
from flask_socketio import SocketIO
import model
from model import db

app = Flask(__name__)
app.config["SECRET_KEY"] = "secret!"  # change in real app
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///newdata.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

# IMPORTANT: attach db to app
db.init_app(app)

socketio = SocketIO(app)

def get_current_user():
    uid = session.get("user")
    if not uid:
        return None
    return model.User.find_by_id(uid)

@app.route("/")
def index():
    return redirect(url_for("login"))
@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        user = model.User.query.filter_by(email=email).first()
        if user is None or not user.check_password(password):
            return render_template("login.html", mode="login", error="Incorrect email or password.")

        session["user"] = user.id
        return redirect(url_for("home"))

    return render_template("login.html", mode="login")


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        name = request.form.get("fullname", "").strip()

        if not username or not email or not password or not name:
            return render_template("login.html", mode="signup", error="Missing required fields.")

        if model.User.query.filter_by(email=email).first():
            return render_template("login.html", mode="signup", error="Email already exists.")

        if model.User.query.filter_by(username=username).first():
            return render_template("login.html", mode="signup", error="Username already taken.")

        new_user = model.User(email=email, name=name, username=username)
        new_user.set_pass(password)

        db.session.add(new_user)
        db.session.commit()

        session["user"] = new_user.id
        return redirect(url_for("home"))

    return render_template("login.html", mode="signup")

@app.route("/home")
def home():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("chat.html", current_user_id=session["user"])

@app.route("/get_pending_requests", methods=["GET"])
def get_pending_requests():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Not logged in"}), 401

    reqs = user.friends_req()
    return jsonify([r.to_dict(current_user_id=user.id) for r in reqs])

@app.route("/sent_requests", methods=["GET"])
def sent_requests():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Not logged in"}), 401

    reqs = user.friends_req_sent()
    return jsonify([r.to_dict(current_user_id=user.id) for r in reqs])

@app.route("/list_friends", methods=["GET"])
def list_friends():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Not logged in"}), 401

    friends = user.all_friends_accm()
    return jsonify([u.to_dict() for u in friends])

@app.route("/searchfriends/<string:username>", methods=["GET"])
def friendSearch(username):
    user = get_current_user()
    if not user:
        return jsonify({"error": "Not logged in"}), 401

    target = model.User.find_by_username(username.strip())
    if not target:
        return jsonify({"found": False}), 404

    rel = model.Friend.between(user.id, target.id)
    rel_status = rel.status if rel else "none"

    return jsonify({
        "found": True,
        "user": target.to_dict(),
        "relationship": rel_status,  # none/pending/accepted/blocked
        "pending": bool(rel and rel.status == "pending"),
        "is_friend": bool(rel and rel.status == "accepted"),
    })

@app.route("/addfriend/<string:username>", methods=["POST"])
def addfriend(username):
    user = get_current_user()
    if not user:
        return jsonify({"error": "Not logged in"}), 401

    target = model.User.find_by_username(username.strip())
    if not target:
        return jsonify({"error": "User not found"}), 404

    try:
        fr = user.send_friend_request(target.id)
        return jsonify(fr.to_dict(current_user_id=user.id))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Could not send request"}), 500

@app.route("/removefriend/<int:other_user_id>", methods=["POST"])
def removefriend(other_user_id):
    user = get_current_user()
    if not user:
        return jsonify({"error": "Not logged in"}), 401

    ok = user.remove_friend(other_user_id)
    if not ok:
        return jsonify({"error": "Not friends"}), 400

    return jsonify({"success": True})

@app.route("/friend_requests/<int:request_id>/accept", methods=["POST"])
def accept_friend_request(request_id):
    user = get_current_user()
    if not user:
        return jsonify({"error": "Not logged in"}), 401

    fr = model.Friend.query.get(request_id)
    if not fr:
        return jsonify({"error": "Request not found"}), 404

    # only the receiver can accept, and only if pending
    if fr.receiver_id != user.id or fr.status != "pending":
        return jsonify({"error": "Not allowed"}), 403

    fr.accept()
    db.session.commit()
    return jsonify(fr.to_dict(current_user_id=user.id))

@app.route("/friend_requests/<int:request_id>/reject", methods=["POST"])
def reject_friend_request(request_id):
    user = get_current_user()
    if not user:
        return jsonify({"error": "Not logged in"}), 401

    fr = model.Friend.query.get(request_id)
    if not fr:
        return jsonify({"error": "Request not found"}), 404

    # only the receiver can reject, and only if pending
    if fr.receiver_id != user.id or fr.status != "pending":
        return jsonify({"error": "Not allowed"}), 403

    db.session.delete(fr)
    db.session.commit()
    return jsonify({"success": True})

if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
