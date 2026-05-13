(function () {
    const WRAP_CLASS = "math-nowrap";
    const TRAILING_PUNCTUATION_RE = /^([.,;:!?…]+)/;

    function wrapInlineMath(node) {
        if (!(node instanceof Element)) {
            return;
        }

        if (node.closest("." + WRAP_CLASS)) {
            return;
        }

        const next = node.nextSibling;
        if (!next || next.nodeType !== Node.TEXT_NODE || !next.nodeValue) {
            return;
        }

        const match = next.nodeValue.match(TRAILING_PUNCTUATION_RE);
        if (!match) {
            return;
        }

        const wrapper = document.createElement("span");
        wrapper.className = WRAP_CLASS;
        node.parentNode.insertBefore(wrapper, node);
        wrapper.appendChild(node);
        wrapper.appendChild(document.createTextNode(match[1]));

        next.nodeValue = next.nodeValue.slice(match[1].length);
        if (!next.nodeValue) {
            next.remove();
        }
    }

    function processInlineMath(root) {
        root.querySelectorAll("span.arithmatex").forEach(wrapInlineMath);
        root
            .querySelectorAll('mjx-container[jax]:not([display="true"])')
            .forEach(wrapInlineMath);
    }

    function run() {
        processInlineMath(document);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
        run();
    }

    if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
        window.MathJax.startup.promise = window.MathJax.startup.promise.then(() => {
            processInlineMath(document);
        });
    } else {
        window.addEventListener("load", run, { once: true });
    }
})();
