const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')

const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const path = require('path')
const dbPath = path.join(__dirname, 'twitterClone.db')

const app = express()
app.use(express.json())
let db = null

const initializeBdAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    const port=process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`Server is running at port ${port}`)
    })
  } catch (e) {
    console.log(`DB Error : ${e.message}`)
    process.exit(1)
  }
}
initializeBdAndServer()

app.get("/", (request, response) => {
  response.send("Twitter Clone Backend is Live and Running!");
});

const authenticationHeader = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, process.env.JWT_SECRET || 'SECRET_KEY', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

//register user API1
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const hashedPassword = await bcrypt.hash(password, 10)
  const selectedQuery = `
  select * from user where username='${username}'`
  const dbUser = await db.get(selectedQuery)
  if (dbUser === undefined) {
    const createQuery = `
    insert into user(username,password,name,gender) 
    values('${username}','${hashedPassword}','${name}','${gender}')`
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      await db.run(createQuery)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

//login user API2
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectedQuery = `
  select * from user where username='${username}'`
  const dbUser = await db.get(selectedQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    isValidPassword = await bcrypt.compare(password, dbUser.password)
    if (isValidPassword === true) {
      const payload = {username: username}
      const jwtToken = jwt.sign(payload, process.env.JWT_SECRET || 'SECRET_KEY')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

const convertLatestTweetsObjToJson = eachObj => {
  return {
    username: eachObj.username,
    tweet: eachObj.tweet,
    dateTime: eachObj.date_time,
  }
}

//latest 4 tweets API3
app.get(
  '/user/tweets/feed/',
  authenticationHeader,
  async (request, response) => {
    const {limit = 4, order = 'desc'} = request.query
    const getQuery = `
  select u.username,t.tweet,t.date_time from follower f 
  join tweet t on f.following_user_id=t.user_id
  join user u on u.user_id=t.user_id 
  where f.follower_user_id=(select user_id from user where username='${request.username}')
  order by t.date_time ${order} 
  limit ${limit}`
    const latestTweets = await db.all(getQuery)
    response.send(latestTweets.map(each => convertLatestTweetsObjToJson(each)))
  },
)

//return list of all names whom user follows API4
app.get('/user/following/', authenticationHeader, async (request, response) => {
  const getNameQuery = `
  select u.name from user u 
  join follower f 
  on u.user_id=f.following_user_id 
  where f.follower_user_id=(select user_id from user where username='${request.username}')`
  const dbResult = await db.all(getNameQuery)
  response.send(dbResult.map(each => ({name: each.name})))
})

//return who follows the user API5
app.get('/user/followers/', authenticationHeader, async (request, response) => {
  const getNameQuery = `
  select u.name from user u 
  join follower f 
  on u.user_id=f.follower_user_id 
  where f.following_user_id=(select user_id from user where username='${request.username}')`
  const dbResult = await db.all(getNameQuery)
  response.send(dbResult.map(each => ({name: each.name})))
})

// get user following details API6
app.get(
  '/tweets/:tweetId/',
  authenticationHeader,
  async (request, response) => {
    const {tweetId} = request.params
    const userFollowQuery = `
  select t.tweet, (select count(*) from like where tweet_id=t.tweet_id) as likes , (select count(*) from reply where tweet_id=t.tweet_id) as replies,t.date_time as dateTime from tweet t 
  where t.tweet_id=${tweetId} and 
  t.user_id IN (select following_user_id from follower where follower_user_id=(select user_id from user where username='${request.username}')) `
    const tweetDetails = await db.get(userFollowQuery)
    if (tweetDetails === undefined) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      response.send(tweetDetails)
    }
  },
)

//get usernames who liked API7
app.get(
  '/tweets/:tweetId/likes/',
  authenticationHeader,
  async (request, response) => {
    const {tweetId} = request.params
    const likedUserQuery = `
  select u.username from like l
  join user u on l.user_id=u.user_id
  where l.tweet_id=${tweetId} and ${tweetId} in (select t.tweet_id from tweet t where t.user_id in (select following_user_id from follower 
  where follower_user_id=(select user_id from user where username='${request.username}')))`
    const getUsernameDetails = await db.all(likedUserQuery)
    if (getUsernameDetails.length === 0) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      response.send({likes: getUsernameDetails.map(each => each.username)})
    }
  },
)

const convertReplyMsgObjToJson = eachObj => {
  return {
    name: eachObj.name,
    reply: eachObj.reply,
  }
}
// get replies API 8
app.get(
  '/tweets/:tweetId/replies/',
  authenticationHeader,
  async (request, response) => {
    const {tweetId} = request.params
    const checkTweetQuery = `
    select tweet_id from tweet where tweet_id=${tweetId} and user_id in (
      select following_user_id from follower where follower_user_id =(
        select user_id from user where username='${request.username}'
      )
    )`
    const validTweet = await db.get(checkTweetQuery)
    if (validTweet === undefined) {
      response.status(401)
      response.send('Invalid Request')
      return
    }
    const replyUsersQuery = `
  select u.name, r.reply from reply r 
  join user u on u.user_id=r.user_id 
  where r.tweet_id=${tweetId}`
    const getReplyDetails = await db.all(replyUsersQuery)
    response.send({
      replies: getReplyDetails.map(each => convertReplyMsgObjToJson(each)),
    })
  },
)

convertAllTweetsObjToJson = eachObj => {
  return {
    tweet: eachObj.tweet,
    likes: eachObj.likes,
    replies: eachObj.replies,
    dateTime: eachObj.dateTime,
  }
}
// return a list of all tweets of user API 9
app.get('/user/tweets/', authenticationHeader, async (request, response) => {
  const getAllTweetsQuery = `
  select t.tweet,(select count(*) from like where tweet_id=t.tweet_id) as likes,
  (select count(*) from reply where tweet_id=t.tweet_id) as replies,t.date_time as dateTime 
  from tweet t 
  where t.user_id=(select user_id from user where username='${request.username}')`
  const dbResult = await db.all(getAllTweetsQuery)
  response.send(dbResult.map(each => convertAllTweetsObjToJson(each)))
})

//create a tweet API 10
app.post('/user/tweets/', authenticationHeader, async (request, response) => {
  const {tweet} = request.body
  const createTweetQuery = `
  insert into tweet (tweet,user_id,date_time)
  values ('${tweet}',(select user_id from user where username='${request.username}'),datetime('now'))`
  await db.run(createTweetQuery)
  response.send('Created a Tweet')
})

//Delete tweet API 11
app.delete(
  '/tweets/:tweetId/',
  authenticationHeader,
  async (request, response) => {
    const {tweetId} = request.params
    const deleteTweetQuery = `
  delete from tweet 
  where tweet_id=${tweetId} and user_id =(select user_id from user where username='${request.username}')`
    const result = await db.run(deleteTweetQuery)
    if (result.changes === 0) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      response.send('Tweet Removed')
    }
  },
)

module.exports = app
