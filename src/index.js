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
import restaurants from './resolvers/yelp'
import weather from './resolvers/weather';

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
    const {term, location} = req.query;
    let tempLocation = location;
    let tempTerm = term;

    tempLocation = tempLocation.toLowerCase();
    tempTerm = tempTerm.toLowerCase();

    if(cache['yelp'][tempTerm] && cache['yelp'][tempTerm][tempLocation]) {
        return res.json(cache['yelp'][tempTerm][tempLocation]);
    }

    yelpObj.body = restaurants(tempTerm, tempLocation)

    fetch('https://api.yelp.com/v3/graphql', yelpObj).then(function(res) {
        return res.text()
    }).then(function(body) {

        if(!cache['yelp'][tempTerm]) {
            cache['yelp'][tempTerm] = {};
            cache['yelp'][tempTerm][tempLocation] = body;
        }

        return res.json(body);
    })
})

app.get('/api/weather', (req, res) => {
    const {location} = req.query;
    let tempLocation = location;
    tempLocation = tempLocation.toLowerCase();

    if(tempLocation.indexOf(',') > -1) {
        tempLocation = tempLocation.split(',')[0];
    }

    let url = weather(tempLocation);

    if(cache['weather'][tempLocation]) {
        return res.json(cache['weather'][tempLocation]);
    }

    fetch(url).then((res) => {
        return res.text();
    }).then((body) => {
        if(!cache['weather'][tempLocation]) {
            cache['weather'][tempLocation] = body;
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
