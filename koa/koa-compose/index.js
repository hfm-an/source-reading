'use strict'

/**
 * Expose compositor.
 */

module.exports = compose

/**
 * Compose `middleware` returning
 * a fully valid middleware comprised
 * of all those which are passed.
 *
 * @param {Array} middleware
 * @return {Function}
 * @api public
 */

function compose (middleware) {
    if (!Array.isArray(middleware)) throw new TypeError('Middleware stack must be an array!')
    for (const fn of middleware) {
        if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!')
    }

    /**
     * @param {Object} context
     * @return {Promise}
     * @api public
     */

    return function (context, next) {
        // last called middleware #
        let index = -1
        return dispatch(0)

        function dispatch (i) {
            // 通过一个 index 和一个当前的 i 控制着 next 的调用次数
            if (i <= index) return Promise.reject(new Error('next() called multiple times'))
            index = i
            let fn = middleware[i]
            // 等到 i === 3 的时候，此时 fn = next
            // 而 next = undefined
            if (i === middleware.length) fn = next
            // 所以这里就刚刚好会 return 一个空的 resolve 状态的 Promise 实例
            if (!fn) return Promise.resolve()
            try {
                // i = 0 的时候，取出来的是第 [0] 个，也就是最先声明的 app.use 的函数
                // 此时会计算 dispatch,bind(null, 1), 所以进入到 i = 1
                // 此时 i = 1, 又会计算 dispatch.bind(null, 2), 进入到 i = 2
                // 这时候实际上会形成一个嵌套的 promise
                // 每个 promise 返回一个 resolve 状态的 promise 实例
                // 最后计算到最内层，实际上 [fn1, fn2, fn3, fn4] 最先执行的是 fn4, 之后才是 fn3, fn2, fn1
                // 我们在写法上，最先写的 app.use(fn1) 的时候，await 了 next()
                // 这时候 fn1 对应着 i = 0 的时候
                // 他的 next() 其实就是 dispatch.bind(null, 1), 也就是第 [1] 个中间件，也就是 fn2
                // 继续 fn2 里 next() dispatch.bind(null, 2), 也就是第 [2] 个中间件，也就是 fn3
                // 而我们 await next() 要求的也必须是返回一个 promise 实例
                // 这里刚刚好满足 = =。一切都是那么的相似
                return Promise.resolve(fn(context, dispatch.bind(null, i + 1)));
            } catch (err) {
                return Promise.reject(err)
            }
        }
    }
}
