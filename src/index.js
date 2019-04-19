import 'dotenv/config';
import cors from 'cors';
import morgan from 'morgan';
import http from 'http';
import jwt from 'jsonwebtoken';
import DataLoader from 'dataloader';
import express from 'express';
import {
  ApolloServer,
  AuthenticationError,
} from 'apollo-server-express';
import fetch from 'node-fetch';
import helmet from 'helmet';
import redis from 'redis';

import schema from './schema';
import resolvers from './resolvers';
import models, { sequelize } from './models';
import loaders from './loaders';
import createUsersWithMessages from './models/testModels';
import restaurants from './resolvers/yelp'
import weather from './resolvers/weather';

const client = redis.createClient('//redis-14157.c60.us-west-1-2.ec2.cloud.redislabs.com:14157', {
    password: 'I2A97eggg5eJInoUjJxos4w1i5kTcf21'
});

const cache = {
    'yelp': {},
    'weather': {}
};
const app = express();

app.use(cors());
app.use(helmet());

app.use(morgan('dev'));

const yelpObj = {
    "method": "POST",
    "headers": {
        "Authorization": 'Bearer ' + process.env.YELP_API,
        "Content-Type": "application/graphql",
    }
}

app.get('/api/yelpsearch', (req, res) => {
    const {location} = req.query;
    let tempLocation = location;

    tempLocation = tempLocation.toLowerCase();

    return client.exists(`${tempLocation.replace(/\"/g, '')}:yelp`, (err, exist) => {

        if(exist) {
            return client.hgetall(`${tempLocation.replace(/\"/g, '')}:yelp`, (err, obj) => {
                return res.json(obj);
            })
        }

        yelpObj.body = restaurants(tempLocation)

        fetch('https://api.yelp.com/v3/graphql', yelpObj).then(function(res) {
            return res.text()
        }).then(function(body) {

            client.hset(`${tempLocation.replace(/\"/g, '')}:yelp`, 'yelp', body);
            return res.json(body);
        })
    });
})

app.get('/api/weather', (req, res) => {
    const {location} = req.query;
    let tempLocation = location;
    tempLocation = tempLocation.toLowerCase();

    if(tempLocation.indexOf(',') > -1) {
        tempLocation = tempLocation.split(',')[0];
    }

    return client.exists(`${tempLocation}:weather`, (err, exist) => {
        if(exist) {
            return client.hgetall(`${tempLocation}:weather`, (err, obj) => {
                return res.json(obj);
            })
        }

        let url = weather(tempLocation);

        fetch(url).then((res) => {
            return res.text();
        }).then((body) => {
            client.hset(`${tempLocation}:weather`, 'weather', body);
            return res.json(body);
        })
    })
})

const getMe = async req => {
  const token = req.headers['x-token'];

  if (token) {
    try {
      return await jwt.verify(token, process.env.SECRET);
    } catch (e) {
      throw new AuthenticationError(
        'Your session expired. Sign in again.',
      );
    }
  }
};

const server = new ApolloServer({
  introspection: true,
  playground: true,
  typeDefs: schema,
  resolvers,
  formatError: error => {
    // remove the internal sequelize error message
    // leave only the important validation error
    const message = error.message
      .replace('SequelizeValidationError: ', '')
      .replace('Validation error: ', '');

    return {
      ...error,
      message,
    };
  },
  context: async ({ req, connection }) => {
    if (connection) {
      return {
        models,
        loaders: {
          user: new DataLoader(keys =>
            loaders.user.batchUsers(keys, models),
          ),
        },
      };
    }

    if (req) {
      const me = await getMe(req);

      return {
        models,
        me,
        secret: process.env.SECRET,
        loaders: {
          user: new DataLoader(keys =>
            loaders.user.batchUsers(keys, models),
          ),
        },
      };
    }
  },
});

server.applyMiddleware({ app, path: '/graphql' });

const httpServer = http.createServer(app);
server.installSubscriptionHandlers(httpServer);

const isTest = !!process.env.TEST_DATABASE;
const isProduction = !!process.env.DATABASE_URL;
const port = process.env.PORT || 8000;

sequelize.sync({ force: isTest || isProduction }).then(async () => {
  if (isTest || isProduction) {
    createUsersWithMessages(new Date());
  }

  httpServer.listen({ port }, () => {
    console.log(`Apollo Server on http://localhost:${port}/graphql`);
  });
});
