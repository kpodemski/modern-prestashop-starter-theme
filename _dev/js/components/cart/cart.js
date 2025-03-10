import $ from 'jquery';
import prestashop from 'prestashop';

prestashop.cart = prestashop.cart || {};

prestashop.cart.active_inputs = null;

const spinnerSelector = 'input[name="product-quantity-spin"]';
let hasError = false;
let isUpdateOperation = false;
let errorMsg = '';

const CheckUpdateQuantityOperations = {
  switchErrorStat: () => {
    /**
     * if errorMsg is not empty or if notifications are shown, we have error to display
     * if hasError is true, quantity was not updated : we don't disable checkout button
     */
    const $checkoutBtn = $('.checkout a');

    if ($('#notifications article.alert-danger').length || (errorMsg !== '' && !hasError)) {
      $checkoutBtn.addClass('disabled');
    }

    if (errorMsg !== '') {
      const strError = `<article class="alert alert-danger" role="alert" data-alert="danger"><ul><li>${errorMsg}</li></ul></article>`;
      $('#notifications .container').html(strError);
      errorMsg = '';
      isUpdateOperation = false;
      if (hasError) {
        // if hasError is true, quantity was not updated : allow checkout
        $checkoutBtn.removeClass('disabled');
      }
    } else if (!hasError && isUpdateOperation) {
      hasError = false;
      isUpdateOperation = false;
      $('#notifications .container').html('');
      $checkoutBtn.removeClass('disabled');
    }
  },
  checkUpdateOpertation: (resp) => {
    /* eslint-disable max-len */
    /**
     * resp.hasError can be not defined but resp.errors not empty: quantity is updated but order cannot be placed
     * when resp.hasError=true, quantity is not updated
     */
    /* eslint-enable max-len */

    hasError = Object.prototype.hasOwnProperty.call(resp, 'hasError');
    const errors = resp.errors || '';

    // 1.7.2.x returns errors as string, 1.7.3.x returns array
    if (errors instanceof Array) {
      errorMsg = errors.join(' ');
    } else {
      errorMsg = errors;
    }

    isUpdateOperation = true;
  },
};

/**
 * Attach Bootstrap TouchSpin event handlers
 */
function createSpin() {
  $.each($(spinnerSelector), (index, spinner) => {
    $(spinner).TouchSpin({
      verticalupclass: 'material-icons touchspin-up',
      verticaldownclass: 'material-icons touchspin-down',
      buttondown_class: 'btn btn-touchspin js-touchspin js-increase-product-quantity',
      buttonup_class: 'btn btn-touchspin js-touchspin js-decrease-product-quantity',
      min: parseInt($(spinner).attr('min'), 10),
      max: 1000000,
    });
  });

  CheckUpdateQuantityOperations.switchErrorStat();
}

$(() => {
  const productLineInCartSelector = '.js-cart-line-product-quantity';
  const promises = [];

  prestashop.on('updateCart', () => {
    $('.quickview').modal('hide');
    $('body').addClass('cart-loading');
  });

  prestashop.on('updatedCart', () => {
    createSpin();
    $('body').removeClass('cart-loading');
  });

  createSpin();

  const $body = $('body');

  function isTouchSpin(namespace) {
    return namespace === 'on.startupspin' || namespace === 'on.startdownspin';
  }

  function shouldIncreaseProductQuantity(namespace) {
    return namespace === 'on.startupspin';
  }

  function findCartLineProductQuantityInput($target) {
    const $input = $target.parents('.bootstrap-touchspin').find(productLineInCartSelector);

    if ($input.is(':focus')) {
      return null;
    }

    return $input;
  }

  function camelize(subject) {
    const actionTypeParts = subject.split('-');
    let i;
    let part;
    let camelizedSubject = '';

    for (i = 0; i < actionTypeParts.length; i += 1) {
      part = actionTypeParts[i];

      if (i !== 0) {
        part = part.substring(0, 1).toUpperCase() + part.substring(1);
      }

      camelizedSubject += part;
    }

    return camelizedSubject;
  }

  function parseCartAction($target, namespace) {
    if (!isTouchSpin(namespace)) {
      return {
        url: $target.attr('href'),
        type: camelize($target.data('link-action')),
      };
    }

    const $input = findCartLineProductQuantityInput($target);

    let cartAction = {};

    if ($input) {
      if (shouldIncreaseProductQuantity(namespace)) {
        cartAction = {
          url: $input.data('up-url'),
          type: 'increaseProductQuantity',
        };
      } else {
        cartAction = {
          url: $input.data('down-url'),
          type: 'decreaseProductQuantity',
        };
      }
    }

    return cartAction;
  }

  const abortPreviousRequests = () => {
    let promise;
    while (promises.length > 0) {
      promise = promises.pop();
      promise.abort();
    }
  };

  const getTouchSpinInput = ($button) => $($button.parents('.bootstrap-touchspin').find('input'));

  const handleCartAction = (event) => {
    event.preventDefault();

    const $target = $(event.currentTarget);
    const { dataset } = event.currentTarget;

    const cartAction = parseCartAction($target, event.namespace);
    const requestData = {
      ajax: '1',
      action: 'update',
    };

    if (typeof cartAction === 'undefined') {
      return;
    }

    abortPreviousRequests();
    $.ajax({
      url: cartAction.url,
      method: 'POST',
      data: requestData,
      dataType: 'json',
      beforeSend: (jqXHR) => {
        promises.push(jqXHR);
      },
    })
      .then((resp) => {
        CheckUpdateQuantityOperations.checkUpdateOpertation(resp);
        const $quantityInput = getTouchSpinInput($target);
        $quantityInput.val(resp.quantity);

        // Refresh cart preview
        prestashop.emit('updateCart', {
          reason: dataset,
          resp,
        });
      })
      .fail((resp) => {
        prestashop.emit('handleError', {
          eventType: 'updateProductInCart',
          resp,
          cartAction: cartAction.type,
        });
      });
  };

  $body.on('click', '[data-link-action="delete-from-cart"], [data-link-action="remove-voucher"]', handleCartAction);

  $body.on('touchspin.on.startdownspin', spinnerSelector, handleCartAction);
  $body.on('touchspin.on.startupspin', spinnerSelector, handleCartAction);

  function sendUpdateQuantityInCartRequest(updateQuantityInCartUrl, requestData, $target) {
    abortPreviousRequests();

    return $.ajax({
      url: updateQuantityInCartUrl,
      method: 'POST',
      data: requestData,
      dataType: 'json',
      beforeSend: (jqXHR) => {
        promises.push(jqXHR);
      },
    })
      .then((resp) => {
        CheckUpdateQuantityOperations.checkUpdateOpertation(resp);
        $target.val(resp.quantity);

        let { dataset } = { ...$target };

        if (!dataset) {
          dataset = resp;
        }

        // Refresh cart preview
        prestashop.emit('updateCart', {
          reason: dataset,
          resp,
        });
      })
      .fail((resp) => {
        prestashop.emit('handleError', {
          eventType: 'updateProductQuantityInCart',
          resp,
        });
      });
  }

  function getQuantityChangeType($quantity) {
    return $quantity > 0 ? 'up' : 'down';
  }

  function getRequestData(quantity) {
    return {
      ajax: '1',
      qty: Math.abs(quantity),
      action: 'update',
      op: getQuantityChangeType(quantity),
    };
  }

  function updateProductQuantityInCart(event) {
    const $target = $(event.currentTarget);
    const updateQuantityInCartUrl = $target.data('update-url');
    const baseValue = $target.attr('value');

    // There should be a valid product quantity in cart
    const targetValue = $target.val();

    if (targetValue !== parseInt(targetValue, 10) || targetValue < 0 || Number.isNaN(targetValue)) {
      $target.val(baseValue);
      return;
    }

    // There should be a new product quantity in cart
    const qty = targetValue - baseValue;

    if (qty === 0) {
      return;
    }

    $target.attr('value', targetValue);
    sendUpdateQuantityInCartRequest(updateQuantityInCartUrl, getRequestData(qty), $target);
  }

  $body.on(
    'focusout keyup',
    productLineInCartSelector,
    (event) => {
      if (event.type === 'keyup') {
        if (event.keyCode === 13) {
          updateProductQuantityInCart(event);
        }
        return false;
      }

      return updateProductQuantityInCart(event);
    },
  );

  $body.on(
    'click',
    '.js-discount .js-code',
    (event) => {
      event.stopPropagation();
      event.preventDefault();

      const $code = $(event.currentTarget);
      const $discountInput = $('[name=discount_name]');
      const $discountForm = $discountInput.closest('form');

      $discountInput.val($code.text());
      // Show promo code field
      $discountForm.trigger('submit');

      return false;
    },
  );
});
