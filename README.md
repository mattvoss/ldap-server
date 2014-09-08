ldap-server
===========

A node ldap server that uses the db structure from dovecot + postfix mysql
authentication scheme.

Installation
------------

```
git clone https://github.com/mattvoss/ldap-server.git
cd ldap-server
npm install
npm start
```

Configuration
----------------------

Located in the config/settings.json file
First copy settings.json.dist to settings.json

```javascript
{
  "mysql":{
    "host"     : "mysql:hostname",
    "username" : "mysql:username",
    "password" : "mysql:password",
    "database" : "mysql:dbname",
    "multipleStatements": true
  },
  "ldap": {
    "port": 389,
    "dn": "dc=example,dc=io",
    "ou": "ou=people",
    "admin": {
      "user": "username",
      "password": "password"
    }
  }
}
```
