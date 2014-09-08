/*  ==============================================================
    Include required packages
=============================================================== */

var fs = require('fs'),
    nconf = require('nconf'),
    path = require('path'),
    ldap = require('ldapjs'),
    Sequelize = require("sequelize"),
    crypt = require("crypt3"),
    server = ldap.createServer(),
    config, configFile, opts, db = {}, models = {};

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

if (config.get("ssl")) {
  if (config.get("ssl:key")) {
    opts.key = fs.readFileSync(config.get("ssl:key"));
  }

  if (config.get("ssl:cert")) {
    opts.cert = fs.readFileSync(config.get("ssl:cert"));
  }

  if (config.get("ssl:ca")) {
    opts.ca = [];
    config.get("ssl:ca").forEach(function (ca, index, array) {
      opts.ca.push(fs.readFileSync(ca));
    });
  }
}

db.mail = new Sequelize(
  config.get("mysql:database"),
  config.get("mysql:username"),
  config.get("mysql:password"),
  {
      dialect: 'mariadb',
      omitNull: true,
      host: config.get("mysql:host") || "localhost",
      port: config.get("mysql:port") || 3306,
      pool: { maxConnections: 5, maxIdleTime: 30},
      define: {
        freezeTableName: true,
        timestamps: false
      }
  }
);

models.VirtualUsers = db.mail.define('virtual_users',
  {
    id:                   { type: Sequelize.INTEGER(11), primaryKey: true },
    domain_id :           { type: Sequelize.INTEGER(11) },
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

var port = config.get("ldap:port") || 389,
    dn = config.get("ldap:dn") || "dc=example,dc=com",
    baseDn = config.get("ldap:ou") + "," + config.get("ldap:dn") || "ou=people,dc=example,dc=com",
    adminUser = config.get("ldap:admin:user") || "admin",
    adminDn = "cn=" + adminUser + "," + baseDn,
    adminPassword = config.get("ldap:admin:password") || "chiCoopooquoo5ai";

server.listen(port, function() {
  console.log('ldapjs listening at ' + server.url);
});

server.bind(baseDn, function (req, res, next) {
  var username = req.dn.toString(),
      password = req.credentials,
      noUser = function() {
        console.log("Invalid credentials for:", username);
        return next(new ldap.InvalidCredentialsError());
      },
      foundUser = function(user) {
        console.log("Login successful for:", username);
        res.end();
        return next();
      };
  console.log("Login attempt for:", username);
  if (username === adminDn) {
    if (password === adminPassword) {
      foundUser({"giveName": "admin"});
    } else {
      noUser();
    }
  } else {
    models.VirtualUsers.find({
      where: {
        dn: username
      }
    }).success(function(user) {
      //console.log(user);
      if (user !== null) {
        var hash = crypt(password, user.password);
        //console.log("calculated hash:", hash);
        //console.log("hash:", user.password);
          if( hash === user.password ) {
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

  models.VirtualUsers.findAll().success(function(users) {
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
      console.log("Search found:", users[i].uid);
      if (req.filter.matches(user.attributes)) {
        res.send(user);
      }
    }
    res.end();
  });

});


