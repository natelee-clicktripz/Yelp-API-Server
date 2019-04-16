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

import schema from './schema';
import resolvers from './resolvers';
import models, { sequelize } from './models';
import loaders from './loaders';
import createUsersWithMessages from './models/testModels';
import searches from './resolvers/yelp'

const cache = {};
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

app.get('/api/yelpsearch', function(req, res) {
    const {term, location} = req.query;
    let tempLocation = location;
    let tempTerm = term;

    tempLocation = tempLocation.toLowerCase();
    tempTerm = tempTerm.toLowerCase();

    if(cache && cache[tempTerm] && cache[tempTerm][tempLocation]) {
        return res.json(cache[tempTerm][tempLocation]);
    }

    yelpObj.body = searches(tempTerm, tempLocation)

    fetch('https://api.yelp.com/v3/graphql', yelpObj).then(function(res) {
        return res.text()
    }).then(function(body) {

        if(!cache[tempTerm]) {
            cache[tempTerm] = {};
            cache[tempTerm][tempLocation] = body;
        }

        return res.json(body);
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
