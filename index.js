require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')

const port = process.env.PORT || 5000
const app = express()
// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rwhf0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {

    const userCollection = client.db('plantNet').collection('users');
    const plantCollection = client.db('plantNet').collection('plants');
    const orderCollection = client.db('plantNet').collection('orders');

    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })

    // save and update user data
    app.post('/users/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = req.body;
      // check if user exists
      const isExists = await userCollection.findOne(query);
      if (isExists) return res.send(isExists);
      const result = await userCollection.insertOne({ ...user, role: 'customer', timestamp: new Date() });
      res.send(result);
    })

    // save plants data in db
    app.post('/plants', verifyToken, async (req, res) => {
      const plant = req.body;
      const result = await plantCollection.insertOne(plant);
      res.send(result);
    })

    app.get('/plants/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await plantCollection.findOne(query);
      res.send(result)

    })

    // get plants data in db
    app.get('/plants', async (req, res) => {
      const plants = await plantCollection.find().toArray();
      res.send(plants);
    })

    // save order data in db
    app.post('/order', verifyToken, async (req, res) => {
      const orderInfo = req.body;
      const result = await orderCollection.insertOne(orderInfo);
      res.send(result);
    })

    // manage plant quantity
    app.patch('/plants/quantity/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const { quantityToUpdate, status } = req.body;
      const filter = { _id: new ObjectId(id) };
      let updatedDoc = {
        $inc: { quantity: -quantityToUpdate }
      }
      if (status === 'increase') {
        updatedDoc = {
          $inc: { quantity: quantityToUpdate }
        }
      }

      const result = await plantCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })

    // get all order from specific customar
    app.get('/customar-order/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { 'customar.email': email };
      const result = await orderCollection.aggregate([
        {
          $match: query,
        },
        {
          $addFields: {
            plantId: { $toObjectId: '$plantId' },
          }
        },
        {
          $lookup: {
            from: 'plants',
            localField: 'plantId',
            foreignField: '_id',
            as: 'plants'
          }
        },
        { $unwind: '$plants' },
        {
          $addFields: {
            name: '$plants.name',
            image: '$plants.image',
            category: '$plants.category',
          }
        },
        {
          $project: {
            plants: 0
          }
        }
      ]).toArray();
      res.send(result)
    })

    // delete or cancle an order
    app.delete('/orders/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const order = await orderCollection.findOne(query);
      if (order.status === 'Delivered') return res.status(409).send({ message: "Can't remove the product, This item already delivered!" });

      const result = await orderCollection.deleteOne(query);
      res.send(result)
    })

    // manage user status and role
    app.patch('/users/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };

      const user = await userCollection.findOne(query);
      if (!user || user?.status === 'Requested') {
        return res.status(400).send('You have already requested, please wait!')
      }

      const updatedDoc = {
        $set: {
          status: 'Requested',
        }
      }
      const result = await userCollection.updateOne(query, updatedDoc);
      res.send(result)
    })

    // get user role
    app.get('/users/role/:email', async (req, res) => {
      const email = req.params.email;
      const result = await userCollection.findOne({ email })
      res.send({ role: result?.role })
    })


    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from plantNet Server..')
})

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`)
})
