from sqlalchemy import and_, or_
from werkzeug.security import generate_password_hash, check_password_hash
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)

    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password = db.Column(db.String(255), nullable=False)

    name = db.Column(db.String(255), nullable=False)
    username = db.Column(db.String(50), unique=True, nullable=False, index=True)

    profile_pic_url = db.Column(db.String(2048), nullable=False, default="/static/image/default.png")

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    friendships_sent = db.relationship(
        "Friend",
        foreign_keys="Friend.sender_id",
        back_populates="sender",
        cascade="all, delete-orphan",
    )

    friendships_received = db.relationship(
        "Friend",
        foreign_keys="Friend.receiver_id",
        back_populates="receiver",
        cascade="all, delete-orphan",
    )

    messages_sent = db.relationship(
        "chat",
        foreign_keys="chat.sender_id",
        back_populates="sender",
        cascade="all, delete-orphan",
    )

    messages_received = db.relationship(
        "chat",
        foreign_keys="chat.receiver_id",
        back_populates="receiver",
        cascade="all, delete-orphan",
    )

    #Helper methods

    #Setter methods
    def set_pass(self, raw_password):
        self.password = generate_password_hash(raw_password)

    def set_name(self, name):
        self.name = name


    def update_prp(self, url):
        self.profile_pic_url = url


    #checker methods
    def check_password(self, raw_password):
        return check_password_hash(self.password, raw_password)

    @classmethod
    def find_by_email(cls, email):
        return User.query.filter_by(email=email).first()

    @classmethod
    def find_by_username(cls, username):
        return User.query.filter_by(username=username).first()

    @classmethod
    def find_by_id(cls, id):
        return db.session.get(cls, id)

    def friends_req(self):
        """Incoming pending requests (people who sent me requests)."""
        return Friend.query.filter_by(receiver_id=self.id, status="pending").all()

    def friends_req_sent(self):
        """Outgoing pending requests (requests I sent)."""
        return Friend.query.filter_by(sender_id=self.id, status="pending").all()

    def all_friends_accm(self):
        """All accepted friendships as a list of User objects."""
        rows = Friend.query.filter(
            Friend.status == "accepted",
            or_(Friend.sender_id == self.id, Friend.receiver_id == self.id),
        ).all()
        return [r.other_user(self.id) for r in rows]

    # ---------- Boolean helpers ----------

    def has_pending_req(self, other_user_id: int) -> bool:
        """True if there is a pending request either direction between me and other."""
        r = Friend.between(self.id, other_user_id)
        return bool(r and r.status == "pending")

    def is_friend(self, other_user_id: int) -> bool:
        """True if accepted friendship exists."""
        r = Friend.between(self.id, other_user_id)
        return bool(r and r.status == "accepted")

    # ---------- Actions ----------

    def send_friend_request(self, other_user_id: int):
        if self.id == other_user_id:
            raise ValueError("Cannot friend yourself")

        existing = Friend.between(self.id, other_user_id)
        if existing:
            # If they already requested you and it's pending, accept it
            if existing.status == "pending" and existing.receiver_id == self.id:
                existing.accept()
                db.session.commit()
            return existing

        fr = Friend(sender_id=self.id, receiver_id=other_user_id, status="pending")
        db.session.add(fr)
        db.session.commit()
        return fr

    def accept_friend(self, other_user_id: int):
        """
        Accept a request that the other user sent to me (must be pending and incoming).
        """
        fr = Friend.query.filter_by(
            sender_id=other_user_id,
            receiver_id=self.id,
            status="pending",
        ).first()

        if not fr:
            return None

        fr.accept()
        db.session.commit()
        return fr

    def decline_friend_req(self, other_user_id: int):
        """
        Decline (delete) an incoming pending request.
        """
        fr = Friend.query.filter_by(
            sender_id=other_user_id,
            receiver_id=self.id,
            status="pending",
        ).first()

        if not fr:
            return False

        db.session.delete(fr)
        db.session.commit()
        return True

    def remove_friend(self, other_user_id: int):
        """
        Remove an accepted friendship (delete the row either direction).
        """
        fr = Friend.between(self.id, other_user_id)
        if not fr or fr.status != "accepted":
            return False

        db.session.delete(fr)
        db.session.commit()
        return True

#---------------------------------------------------------------------

class Friend(db.Model):
    __tablename__ = 'friends'
    id = db.Column(db.Integer, primary_key=True)

    # who sent the request
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    # who received the request
    receiver_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    # "pending", "accepted", "blocked"
    status = db.Column(db.String(20), nullable=False, default="pending")

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    accepted_at = db.Column(db.DateTime, nullable=True)

    __table_args__ = (
        db.UniqueConstraint("sender_id", "receiver_id", name="uq_friend_pair_direction"),
        db.CheckConstraint("sender_id != receiver_id", name="ck_no_self_friend"),
        db.Index("ix_friends_sender", "sender_id"),
        db.Index("ix_friends_receiver", "receiver_id"),
        db.Index("ix_friends_status", "status"),
    )

    sender = db.relationship(
        "User",
        foreign_keys=[sender_id],
        back_populates="friendships_sent",
    )
    receiver = db.relationship(
        "User",
        foreign_keys=[receiver_id],
        back_populates="friendships_received",
    )

    #helper methods

    @classmethod
    def between(cls, user_a_id: int, user_b_id: int):
        """Return the Friend row between two users in either direction, or None."""
        return cls.query.filter(
            or_(
                and_(cls.sender_id == user_a_id, cls.receiver_id == user_b_id),
                and_(cls.sender_id == user_b_id, cls.receiver_id == user_a_id),
            )
        ).first()

    def other_user(self, my_user_id: int):
        """Given one side's user id, return the User on the other side."""
        return self.receiver if self.sender_id == my_user_id else self.sender

    def accept(self):
        self.status = "accepted"
        self.accepted_at = datetime.utcnow()


class chat(db.Model):
    __tablename__ = 'chats'
    id = db.Column(db.Integer, primary_key=True)

    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    # who received the request
    receiver_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    message = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    sender = db.relationship("User", foreign_keys=[sender_id], back_populates="messages_sent")
    receiver = db.relationship("User", foreign_keys=[receiver_id], back_populates="messages_received")






