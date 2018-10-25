'use strict';

/**
 * Module dependencies.
 */

const isGeneratorFunction = require('is-generator-function');
const debug = require('debug')('koa:application');
const onFinished = require('on-finished');
const response = require('./response');
const compose = require('koa-compose');
const isJSON = require('koa-is-json');
const context = require('./context');
const request = require('./request');
const statuses = require('statuses');
const Emitter = require('events');
const util = require('util');
const Stream = require('stream');
const http = require('http');
const only = require('only');
const convert = require('koa-convert');
const deprecate = require('depd')('koa');

/**
 * Expose `Application` class.
 * Inherits from `Emitter.prototype`.
 * 继承自 Emit
 */

module.exports = class Application extends Emitter {
    /**
     * Initialize a new `Application`.
     *
     * @api public
     */

    constructor () {
        super();

        this.proxy = false;
        this.middleware = [];
        this.subdomainOffset = 2;
        this.env = process.env.NODE_ENV || 'development';
        this.context = Object.create(context);
        this.request = Object.create(request);
        this.response = Object.create(response);
        if (util.inspect.custom) {
            this[util.inspect.custom] = this.inspect;
        }
    }

    /**
     * Shorthand for:
     *
     *    http.createServer(app.callback()).listen(...)
     *
     * @param {Mixed} ...
     * @return {Server}
     * @api public
     */

    listen (...args) {
        debug('listen');
        // callback 函数会返回另一个函数
        // 这个函数作为 createServer 的回调函数
        // 有请求进来的时候，会执行那个函数
        const server = http.createServer(this.callback());
        // 只是 http.createServer 的语法糖
        return server.listen(...args);
    }

    /**
     * Return JSON representation.
     * We only bother showing settings.
     *
     * @return {Object}
     * @api public
     */

    toJSON () {
        return only(this, [
            'subdomainOffset',
            'proxy',
            'env'
        ]);
    }

    /**
     * Inspect implementation.
     *
     * @return {Object}
     * @api public
     */

    inspect () {
        return this.toJSON();
    }

    /**
     * Use the given middleware `fn`.
     *
     * Old-style middleware will be converted.
     *
     * @param {Function} fn
     * @return {Application} self
     * @api public
     *
     * use 方法的作用，仅仅是向 middleware 这个 list 里添加中间件
     */

    use (fn) {
        if (typeof fn !== 'function') throw new TypeError('middleware must be a function!');
        if (isGeneratorFunction(fn)) {
            deprecate('Support for generators will be removed in v3. ' +
                'See the documentation for examples of how to convert old middleware ' +
                'https://github.com/koajs/koa/blob/master/docs/migration.md');
            fn = convert(fn);
        }
        debug('use %s', fn._name || fn.name || '-');
        this.middleware.push(fn);
        return this;
    }

    /**
     * Return a request handler callback
     * for node's native http server.
     *
     * @return {Function}
     * @api public
     */

    callback () {
        const fn = compose(this.middleware);

        if (!this.listenerCount('error')) this.on('error', this.onerror);

        const handleRequest = (req, res) => {
            // 依据当前的 req 和 res
            // 来生成 koa 请求的 context
            const ctx = this.createContext(req, res);
            // 将这个请求唯一的 req 和 res 生成 context，与 fn 传入到 this.handleRequest 函数中
            return this.handleRequest(ctx, fn);
        };

        return handleRequest;
    }

    /**
     * Handle request in callback.
     *
     * @api private
     */

    handleRequest (ctx, fnMiddleware) {
        // 把 ctx.res 取出来
        // ctx.res 其实就是 http 模块里的那个 request
        // 因为上面那个 handleRequest 方法，其实可以理解为
        // const server = http.createServer( (req, res) => {
        //     const ctx = createCtx()
        //     ctx.req = req; ctx.res = res
        // } )
        const res = ctx.res;
        res.statusCode = 404;
        const onerror = err => ctx.onerror(err);
        const handleResponse = () => respond(ctx);
        onFinished(res, onerror);
        return fnMiddleware(ctx).then(handleResponse).catch(onerror);
    }

    /**
     * Initialize a new context.
     *
     * @api private
     */

    createContext (req, res) {
        // 这个方法里做了各种代理
        // 各种函数名称的代理
        const context = Object.create(this.context);
        const request = context.request = Object.create(this.request);
        const response = context.response = Object.create(this.response);
        context.app = request.app = response.app = this;
        context.req = request.req = response.req = req;
        context.res = request.res = response.res = res;
        request.ctx = response.ctx = context;
        request.response = response;
        response.request = request;
        context.originalUrl = request.originalUrl = req.url;
        context.state = {};
        return context;
    }

    /**
     * Default error handler.
     *
     * @param {Error} err
     * @api private
     */

    onerror (err) {
        if (!(err instanceof Error)) throw new TypeError(util.format('non-error thrown: %j', err));

        if (404 == err.status || err.expose) return;
        if (this.silent) return;

        const msg = err.stack || err.toString();
        console.error();
        console.error(msg.replace(/^/gm, '  '));
        console.error();
    }
};

/**
 * Response helper.
 * 处理 response
 */

function respond (ctx) {
    // allow bypassing koa
    if (false === ctx.respond) return;

    const res = ctx.res;
    if (!ctx.writable) return;

    let body = ctx.body;
    const code = ctx.status;

    // ignore body
    if (statuses.empty[code]) {
        // strip headers
        ctx.body = null;
        return res.end();
    }

    // 单独处理 head 请求
    if ('HEAD' == ctx.method) {
        if (!res.headersSent && isJSON(body)) {
            ctx.length = Buffer.byteLength(JSON.stringify(body));
        }
        return res.end();
    }

    // status body
    if (null == body) {
        body = ctx.message || String(code);
        if (!res.headersSent) {
            ctx.type = 'text';
            ctx.length = Buffer.byteLength(body);
        }
        return res.end(body);
    }

    // responses
    // 不同的 body 类型
    if (Buffer.isBuffer(body)) return res.end(body);
    if ('string' == typeof body) return res.end(body);
    if (body instanceof Stream) return body.pipe(res);

    // body: json
    body = JSON.stringify(body);
    if (!res.headersSent) {
        ctx.length = Buffer.byteLength(body);
    }
    res.end(body);
}
