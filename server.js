/*  ==============================================================
    Include required packages
=============================================================== */

var fs = require('fs'),
    nconf = require('nconf'),
    path = require('path'),
    ldap = require('ldapjs'),
    Sequelize = require("sequelize"),
    crypt = require("crypt3"),
    bunyan = require('bunyan'),
    logger = bunyan.createLogger({
      name: 'ldapjs',
      component: 'client',
      streams: [
        {
          path: 'ldap-server.log'
        }
      ],
      serializers: bunyan.stdSerializers
    }),
    server,
    config, configFile, opts = {}, db = {}, models = {}, dbTable;

/*  ==============================================================
    Configuration
=============================================================== */

//used for session and password hashes
var salt = '20sdkfjk23';

if (process.argv[2]) {
  if (fs.lstatSync(process.argv[2])) {
    configFile = require(process.argv[2]);
  } else {
    configFile = process.cwd() + '/config/settings.json';
  }
} else {
  configFile = process.cwd()+'/config/settings.json';
}

config = nconf
  .argv()
  .env("__")
  .file({ file: configFile });

if (config.get("log")) {
  var access_logfile = fs.createWriteStream(config.get("log"), {flags: 'a'});
}

if (config.get("ldap:ssl")) {
  if (config.get("ldap:ssl:key")) {
    logger.info("key:", config.get("ldap:ssl:key"));
    opts.key = fs.readFileSync(config.get("ldap:ssl:key")).toString('utf8');
  }

  if (config.get("ldap:ssl:cert")) {
    logger.info("cert:", config.get("ldap:ssl:cert"));
    opts.certificate = fs.readFileSync(config.get("ldap:ssl:cert")).toString('utf8');
  }

  if (config.get("ldap:ssl:ca")) {
    opts.ca = [];
    config.get("ldap:ssl:ca").forEach(function (ca, index, array) {
      opts.ca.push(fs.readFileSync(ca));
    });
  }
}

if (config.get("mysql")) {
  db.mail = new Sequelize(
    config.get("mysql:database"),
    config.get("mysql:username"),
    config.get("mysql:password"),
    {
        dialect: 'mysql',
        host: config.get("mysql:host") || "localhost",
        port: config.get("mysql:port") || 3306,
        pool: { maxConnections: 5, maxIdleTime: 30}
    }
  );
  dbTable = config.get("mysql:userTable");
} else if (config.get("sqlite")) {
  db.mail = new Sequelize(
    '',
    '',
    '',
    {
        dialect: 'sqlite',
        storage: config.get("sqlite:storage")
    }
  );
  dbTable = config.get("sqlite:userTable");
}

models.Users = db.mail.define(dbTable,
  {
    id:                   { type: Sequelize.INTEGER(11), primaryKey: true },
    password:             { type: Sequelize.STRING(106) },
    email:                { type: Sequelize.STRING(120) },
    dn:                   { type: Sequelize.STRING(255) },
    cn:                   { type: Sequelize.STRING(255) },
    givenName:            { type: Sequelize.STRING(255) },
    sn:                   { type: Sequelize.STRING(255) },
    uid:                  { type: Sequelize.STRING(255) }
  },
  {
    getterMethods: {
      mail: function () { return this.getDataValue('email'); }
    },
    setterMethods: {
      mail: function (v) { this.setDataValue('email', v); }
    }
  }
);

opts.log = logger;
server = ldap.createServer(opts);
var port = config.get("ldap:port") || 389,
    dn = config.get("ldap:dn") || "dc=example,dc=com",
    baseDn = config.get("ldap:ou") + "," + config.get("ldap:dn") || "ou=people,dc=example,dc=com",
    adminUser = config.get("ldap:admin:user") || "admin",
    adminDn = "cn=" + adminUser + "," + baseDn,
    adminPassword = config.get("ldap:admin:password") || "chiCoopooquoo5ai";

server.listen(port, function() {
  logger.info('ldapjs listening at ' + server.url);
});

server.bind(baseDn, function (req, res, next) {
  var username = req.dn.toString(),
      password = req.credentials,
      noUser = function() {
        logger.info("Invalid credentials for:", username);
        return next(new ldap.InvalidCredentialsError());
      },
      foundUser = function(user) {
        logger.info("Login successful for:", username);
        res.end();
        return next();
      };
  logger.info("Login attempt for:", username);
  if (username === adminDn) {
    if (password === adminPassword) {
      foundUser({"giveName": "admin"});
    } else {
      noUser();
    }
  } else {
    models.Users.find({
      where: {
        dn: username
      }
    }).then(function(user) {
      //logger.info(user.password);
      if (user !== null) {
        var encPass = user.password.replace("{SHA512-CRYPT}",""),
            hash = crypt(password, encPass);
        //logger.info("calculated hash:", hash);
        //logger.info("hash:", encPass);
          if( hash === encPass ) {
            foundUser(user);
          } else {
            noUser();
          }
      } else {
        noUser();
      }
    });
  }
});

server.search(baseDn, function(req, res, next) {
  var binddn = req.connection.ldap.bindDN.toString();

  models.Users.findAll({
    where: {
      dn: {
       $ne: null
      }
    }
  }).then(
    function(users) {
      for (var i = 0; i < users.length; i++) {
        var user = {
              dn: users[i].dn,
              attributes: {
                objectclass: ['top', 'organization', 'person', 'user']
              }
            };
        Object.keys(users[i].dataValues).forEach(function(key) {
          user.attributes[key] = [users[i].dataValues[key]];
        });
        user.attributes.mail = users[i].mail;
        delete user.attributes.dn;
        logger.info("Search found:", users[i].uid);
        if (req.filter.matches(user.attributes)) {
          res.send(user);
        }
      }
      res.end();
    }
  );

});


