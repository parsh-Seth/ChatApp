from model import db
from flask import Flask, request, render_template, redirect, url_for, session, jsonify
from flask_socketio import SocketIO, emit


app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'  # change in real app
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///data.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

socketio = SocketIO(app)
db.init_app(app)


import model


user_sid = {}
sid_user = {}

@app.route('/')
def index():
    return redirect(url_for("login"))


@app.route('/login', methods=['GET','POST'])
def login():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form['password']

        user = model.User.query.filter_by(email=email).first()

        if user is None or password != user.password:
            return render_template(
                'login.html',
                email="That email or password was incorrect."
            )

        session['user'] = user.id
        return redirect(url_for("home"))

    return render_template('login.html')

@app.route('/signup', methods=['GET','POST'])
def signup():
    if request.method == 'POST':
        username = request.form['username']
        email = request.form['email']
        password = request.form['password']
        name = request.form['fullname']

    if model.User.query.filter_by(email=email).first() is not None:
        return render_template(
            'login.html',
            email="That email exists."
        )

    new_user = model.User(email=email, password=password, name=name, username=username)

    try:
        db.session.add(new_user)
        db.session.commit()
    except Exception as e:
        print(e)
        return render_template('login.html',
            email="Error occured.")

    session['user'] = new_user.id
    return redirect(url_for("home"))

@app.route('/home')
def home():
    if 'user' not in session:
        return redirect(url_for('login'))

    return render_template("chat.html", current_user_id=session['user'])

@app.route('/get_pending_requests')
def get_pending_requests():
    if 'user' not in session:
        return redirect(url_for('login'))

    id = session.get('user')
    user = model.User.find_by_id(id)

    if user is None:
        return jsonify({"error": "Not logged in"}), 401

    l = user.friends_req()
    data = []

    for item in l:
        r = item.sender
        data.append({"id": r.id,  "name": r.name, "username": r.username, "profile_pic_url" : r.profile_pic_url})

    return jsonify({"data" : data})

@app.route('/sent_requests')
def sent_requests():
    if 'user' not in session:
        return redirect(url_for('login'))

    id = session.get('user')
    user = model.User.find_by_id(id)

    if user is None:
        return jsonify({"error": "Not logged in"}), 401

    l = user.friends_req_sent()
    data = []

    for item in l:
        r = item.receiver
        data.append({"id": r.id, "name": r.name, "username": r.username, "profile_pic_url" : r.profile_pic_url})

    return jsonify({"data" : data})

@app.route('/list_friends')
def list_friends():
    if 'user' not in session:
        return redirect(url_for('login'))

    id = session.get('user')
    user = model.User.find_by_id(id)

    if user is None:
        return jsonify({"error": "Not logged in"}), 401

    l = user.all_friends_accm()
    data = []

    for item in l:
        r = item
        data.append({"id": r.id, "name": r.name, "username": r.username, "profile_pic_url": r.profile_pic_url})

    return jsonify({"data": data})


@app.route('/search/<string:username>', methods=["GET"])
def search(username):
    friend = username
    if not friend:
        return jsonify({"error": "Invalid Entry"}), 401

    user = model.User.query.filter_by(username=username).first()
    if not user:
        return jsonify({"error": "User not found"}), 404

    return jsonify({"id": user.id, "username": user.username, "name": user.name, "profile_pic" : user.profile_pic_url}), 200



@app.route("/addfriend/<int:other_user_id>", methods=["POST"])
def addfriend(other_user_id):
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 401

    me = model.User.find_by_id(session["user"])
    if not me:
        return jsonify({"error": "Not logged in"}), 401

    other = model.User.find_by_id(other_user_id)
    if not other:
        return jsonify({"error": "User not found"}), 404

    try:
        fr = me.send_friend_request(other_user_id)
        # send_friend_request may auto-accept if they already sent you a request
        return jsonify({
            "message": "ok",
            "status": fr.status,
            "sender_id": fr.sender_id,
            "receiver_id": fr.receiver_id,
            "friendship_id": fr.id
        }), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

@app.route("/accept_friends/<int:other_user_id>", methods=["POST"])
def accept_friends(other_user_id):
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 401

    me = model.User.find_by_id(session["user"])
    if me.accept_friend(other_user_id):
        return jsonify({"message": "success"}), 200
    else:
        return jsonify({"message": "error"}), 400

@app.route("/decline_friends/<int:other_user_id>", methods=["POST"])
def decline_friends(other_user_id):
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 401
    me = model.User.find_by_id(session["user"])
    if me.decline_friend_req(other_user_id):
        return jsonify({"message": "success"}), 200
    else:
        return jsonify({"message": "error"}), 400

@app.route("/remove_friend/<int:other_user_id>", methods=["POST"])
def remove_friend(other_user_id):
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 401

    me = model.User.find_by_id(session["user"])
    if me.remove_friend(other_user_id):
        return jsonify({"message": "remove success"}), 200
    else:
        return jsonify({"error": "User not found"}), 404

@socketio.on('connect')
def handle_connect():
    print('Client connected:', request.sid)

@socketio.on('register')
def handle_register(data):
    """Client sends their username after connecting."""
    username = data.get('username')
    if not username:
        return

    # Remove old mapping for this username if any
    old_sid = user_sid.get(username)
    if old_sid and old_sid != request.sid:
        sid_user.pop(old_sid, None)

    user_sid[username] = request.sid
    sid_user[request.sid] = username

    print(f'{username} registered with sid {request.sid}')
    # Send updated user list to everyone
    emit('user_list', list(user_sid.keys()), broadcast=True)

@socketio.on('private_message')
def handle_private_message(data):
    recipient_username = data.get('to')
    body = (data.get('message') or '').strip()
    if not recipient_username or not body:
        return

    sender_username = sid_user.get(request.sid)
    if not sender_username:
        emit('error_message', {'error': 'Not registered.'})
        return

    sender_user = model.User.query.filter_by(username=sender_username).first()
    recipient_user = model.User.query.filter_by(username=recipient_username).first()

    if not recipient_user:
        emit('error_message', {'error': f'User {recipient_username} not found.'})
        return


    # ✅ Save always (use receiver_id)


    payload = {'from': sender_username, 'message': body, 'sender_id': sender_user.id}

    target_sid = user_sid.get(recipient_username)
    if target_sid:
        emit('private_message', payload, room=target_sid)
        emit('private_message', payload, room=request.sid)
    else:
        new_msg = model.chat(
            sender_id=sender_user.id,
            receiver_id=recipient_user.id,
            message=body
        )
        db.session.add(new_msg)
        db.session.commit()


@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    username = sid_user.pop(sid, None)
    if username and username in user_sid:
        user_sid.pop(username, None)
        print(f'{username} disconnected')
        emit('user_list', list(user_sid.keys()), broadcast=True)
    else:
        print('Client disconnected:', sid)

@app.route("/me")
def me():
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 401
    u = model.User.find_by_id(session["user"])
    if not u:
        return jsonify({"error": "Not logged in"}), 401
    return jsonify({"id": u.id, "username": u.username, "name": u.name, "profile_pic_url": u.profile_pic_url})

@app.route("/undelivered_msg/<int:other_user_id>", methods=["GET"])
def undelivered_msg(other_user_id):
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 401

    me_id = session["user"]

    msgs = model.chat.query.filter(
        model.chat.receiver_id == me_id,
        model.chat.sender_id == other_user_id
    ).order_by(model.chat.id.asc()).all()

    data = [{"from": m.sender_id, "message": m.message} for m in msgs]

    for m in msgs:
        db.session.delete(m)
    db.session.commit()

    return jsonify({"data": data}), 200



if __name__ == '__main__':
        with app.app_context():
            db.create_all()
        socketio.run(app, host='0.0.0.0', port=5000, debug=True)