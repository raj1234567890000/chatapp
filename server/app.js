const express = require("express");
const bcryptjs = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = express();
const cors = require("cors");
app.use(cors());

const io = require("socket.io")(8080, {
  cors: {
    origin: "http://localhost:3000",
  },
});

require("./db/connection");

const users = require("./Models/users");
const Conversation = require("./Models/Conversation");
const { JsonWebTokenError } = require("jsonwebtoken");
const Messages = require("./Models/Messages");

app.use(express.json());

app.use(express.urlencoded({ extended: false }));

let Users = [];
io.on("connection", socket => {
  console.log("user connected", socket.id);
  socket.on("addUser", (userId) => {
    const isUserExist = Users.find(user => user.userId === userId);
    if (!isUserExist) {
      const user = { userId, socketId: socket.id };
      Users.push(user);
      io.emit("getUser",Users);
      //console.log(users, "User");
    }
  });
  socket.on( "sendMessage",async({ senderId, receiverId, message, ConversationId }) => {
    console.log({ senderId, receiverId, message, ConversationId });
    const receiver = Users.find(user => user.userId === receiverId);
    const sender=Users.find(user=> user.userId === senderId);
    const user= await users.findById(senderId)
    if (receiver) {
      io.to(receiver.socketId).to(sender.socketId).emit("getMessage", {
        senderId,
        message,
        ConversationId,
        receiverId,
        user:{ id:user._id,fullName:user.fullName,email:user.email}
      });
    }
  }),

  socket.on("disconnect", () => {
    Users = Users.filter((user) => user.socketId !== socket.id);
    io.emit("removeUser", users);
    console.log(users, "after disconnection");
  });
});

app.get("/", (req, resp) => {
  resp.send("rohit");
  resp.end();
});
app.post("/api/register", async (req, resp, next) => {
  try {
    let { fullName, email, password, id } = req.body;
    if (!fullName || !email || !password) {
      return resp.status(400).send("Please fill all required fields");
    }

    const isAlreadyExist = await users.findOne({ email });
    if (isAlreadyExist) {
      return resp.status(400).send("User already exists");
    }

    const JWT_SECRET_KEY =
      process.env.Jwt_SECRET_KEY || "THIS_IS_A_JWT_SECRET_KEY";
    password = await bcryptjs.hash(password, 10);
    const payload = { email };
    const token = jwt.sign(payload, JWT_SECRET_KEY, { expiresIn: 84600 });
    const newUser = new users({ fullName, email, password, token, id });

    await newUser.save();

    return resp.status(200).json({
      user: {
        id: newUser._id,
        email: newUser.email,
        fullName: newUser.fullName,
      },
      token: newUser.token,
    });
  } catch (error) {
    console.log(error, "error");
    return resp.status(500).send("Internal Server Error");
  }
});

app.post("/api/login", async (req, resp, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      resp.status(400).send("plese fill required filed");
    } else {
      const user = await users.findOne({ email });
      if (!user) {
        resp.status(400).send("user email or password is incorrect");
      } else {
        const validateUser = await bcryptjs.compare(password, user.password);
        if (!validateUser) {
          resp.status(400).send("user email or passowrd is incorrect");
        } else {
          const payload = {
            email: user.email,
          };
          const JWT_SECRET_KEY =
            process.env.Jwt_SECRET_KEY || "THIS_IS_A_JWT_SECRET_KEY";

          jwt.sign(
            payload,
            JWT_SECRET_KEY,
            { expiresIn: 84600 },
            async (err, token) => {
              await users.updateOne(
                { _id: user._id },
                {
                  $set: { token },
                }
              );
              user.save();
              return resp.status(200).json({
                user: {
                  id: user._id,
                  email: user.email,
                  fullName: user.fullName,
                },
                token: user.token,
              });
            }
          );
        }
      }
    }
  } catch (error) {
    console.log(error, "error");
  }
});
app.post("/api/conversation", async (req, resp) => {
  try {
    const { senderId, receiverId } = req.body;
    const newConversation = await new Conversation({
      members: [senderId, receiverId],
    });
    await newConversation.save();
    resp.status(200).send("conversation created successfully");
  } catch (error) {
    console.log(error, "error");
  }
});
{
  app.get("/api/conversation/:userId", async (req, resp) => {
    try {
      const userId = req.params.userId;
      const conversations = await Conversation.find({
        members: { $in: [userId] },
      });
      //resp.status(200).json(conversations)

      const ConversationUserData = Promise.all(
        conversations.map(async (Conversation) => {
          const receiverId = await Conversation.members.find(
            (member) => member !== userId
          );
          const user = await users.findById(receiverId);
          //console.log("user",receiverId);
          return {
            user: {
              receiverId: user._id,
              email: user.email,
              fullName: user.fullName,
            },
            ConversationId: Conversation._id,
          };
        })
      );
      resp.status(200).json(await ConversationUserData);
    } catch (error) {
      console.log(error, "error");
    }
  });
}
app.post("/api/message", async (req, resp) => {
  try {
    const { ConversationId, senderId, message, receiverId = "" } = req.body;
   // console.log({ ConversationId, senderId, message, receiverId });
    if (!senderId || !message)
      return resp.status(400).send("plese fill all required field");
    if (ConversationId === "new" && receiverId) {
      const newConversation = new Conversation({
        member: [senderId, receiverId],
      });
      await newConversation.save();
      const newmessage = new Messages({
        ConversationId: newConversation._id,
        senderId,
        message,
      });
      await newmessage.save();
      return resp.status(200).send("message send successfully");
    } else if (!ConversationId && receiverId) {
      return resp.status(400).send("plese fill all required filled");
    }

    const newMessage = new Messages({ ConversationId, senderId, message });
    //console.log({ ConversationId, senderId, message }, req.body)
    await newMessage.save();
    resp.status(200).send("message send succesfully");
  } catch (error) {
    console.log(error, "Error");
  }
});

app.get("/api/message/:ConversationId", async (req, resp) => {
  try {
    const checkMessages = async (ConversationId) => {
      const messages = await Messages.find({ ConversationId });
      const messageUserData = Promise.all(
        messages.map(async (message) => {
          const user = await users.findById(message.senderId);
          //  console.log("user",message.senderId);
          return {
            user: { id: user._id, email: user.email, fullName: user.fullName },
            message: message.message,
          };
        })
      );
      resp.status(200).json(await messageUserData);
    };

    const ConversationId = req.params.ConversationId;
    if (ConversationId === "new") {
      const checkConversation = await Conversation.find({
        members: { $all: [req.query.senderId, req.query.receiverId] },
      });
      if (checkConversation.lenght > 0) {
        checkMessages(checkConversation[0]._id);
      } else {
        return resp.status(200).json([]);
      }
    } else {
      checkMessages(ConversationId);
    }
  } catch (error) {
    console.log(error, "Error");
  }
});
app.get("/api/userr/:userId", async (req, resp) => {
  try {
    const userId = req.params.userId;

    const user = await users.find({ _id: { $ne: userId } });
    const userData = Promise.all(
      user.map(async (user) => {
        return {
          user: {
            email: user.email,
            fullName: user.fullName,
            receiverId: user._id,
          },
        };
      })
    );

    resp.status(200).json(await userData);
  } catch (error) {
    console.log(error, "error");
  }
});

app.listen(4000);
