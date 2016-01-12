angular.module('ion-google-place', [])
    .directive('ionGooglePlace', [
        '$ionicTemplateLoader',
        '$ionicBackdrop',
        '$ionicPlatform',
        '$q',
        '$timeout',
        '$rootScope',
        '$document',
        function($ionicTemplateLoader, $ionicBackdrop, $ionicPlatform, $q, $timeout, $rootScope, $document) {
            return {
                require: '?ngModel',
                restrict: 'E',
                template: '<input type="text" readonly="readonly" class="ion-google-place" autocomplete="off">',
                replace: true,
                scope: {
                    ngModel: '=?',
                    geocodeOptions: '=',
                    defaultLocations: '='
                },
                link: function(scope, element, attrs, ngModel) {
                    var alwaysShownLocations = [],
                        defaultLocations = [];

                    scope.locations = scope.defaultLocations;

                    var defaultLocationsWatcher = scope.$watch('defaultLocations', function (newValue, oldValue) {
                        if (newValue && newValue instanceof Array && newValue.length) {
                            alwaysShownLocations.length = 0;
                            defaultLocations.length = 0;

                            newValue.map(function (location) {
                                if (location.shouldAlwaysBeShown) {
                                    alwaysShownLocations.push(location);
                                } else {
                                    defaultLocations.push(location);
                                }
                            });

                            scope.locations = alwaysShownLocations.concat(defaultLocations);
                        }
                    });

                    var unbindBackButtonAction;
                    var geocoder = new google.maps.Geocoder();
                    var searchEventTimeout = undefined;

                    // create fake hidden input, because google.maps.places.PlacesService won't work without it

                    var input = document.createElement('input');
                    input.type = 'text';
                    input.style.display = 'none';
                    input.className = 'fake-hidden-input';
                    document.body.appendChild(input);

                    var POPUP_TPL = [
                        '<div class="ion-google-place-container modal"' + (attrs.popupId ? ('id="' + attrs.popupId + '"') : '') + '>',
                            '<div class="bar bar-header item-input-inset">',
                                '<label class="item-input-wrapper">',
                                    '<i class="icon ion-ios-search placeholder-icon"></i>',
                                    '<input ' + (attrs.popupId ? ('id="' + attrs.popupId + '-input"') : '') + ' class="google-place-search" type="search" ng-model="searchQuery" placeholder="' + (attrs.searchPlaceholder || 'Enter an address, place or ZIP code') + '">',
                                '</label>',
                                '<button class="button button-clear">',
                                    attrs.labelCancel || 'Cancel',
                                '</button>',
                            '</div>',
                            '<ion-content class="has-header has-header">',
                                '<ion-list>',
                                    '<ion-item ng-repeat="location in locations track by $index" type="item-text-wrap" ng-click="selectLocation(location)">',
                                        '<i ng-if="location.icon" class="icon" ng-class="location.icon"></i>',
                                        '<span ng-if="location.placeholder"> {{location.placeholder}}</span>',
                                        '<span ng-if="!location.placeholder">',
                                            '<span ng-if="shouldNameBeShown(location.types) && location.name"> {{ location.name }},</span> {{location.formatted_address}}',
                                        '</span>',
                                    '</ion-item>',
                                '</ion-list>',
                            '</ion-content>',
                        '</div>'
                    ].join('');

                    /*
                     * Check if location.name should be shown
                     */
                    scope.shouldNameBeShown = function(locationTypes) {
                        if (!locationTypes) {
                            return false;
                        }

                        var typesToExclude = ['street_address'],
                            shouldBeShown = true;

                        for (var i = 0; i < locationTypes.length; i++) {
                            if (typesToExclude.indexOf(locationTypes[i]) >= 0) {
                                shouldBeShown = false;
                                break;
                            }
                        }
                        return shouldBeShown;
                    }

                    var popupPromise = $ionicTemplateLoader.compile({
                        template: POPUP_TPL,
                        scope: scope,
                        appendTo: $document[0].body
                    });

                    popupPromise.then(function(el){
                        var searchInputElement = angular.element(el.element.find('input'));

                        scope.selectLocation = function(location){
                            ngModel.$setViewValue(location);
                            ngModel.$render();
                            el.element.css('display', 'none');

                            scope.searchQuery = '';

                            $ionicBackdrop.release();

                            if (unbindBackButtonAction) {
                                unbindBackButtonAction();
                                unbindBackButtonAction = null;
                            }
                        };

                        function mapsGeocode(req, callback) {
                            geocoder.geocode(req, function(results, status) {
                                if (status !== google.maps.GeocoderStatus.OK) {
                                    return;
                                }
                                callback(results);
                            });
                        }

                        function placesGeocode(req, callback) {
                            var autocompleteService = new google.maps.places.AutocompleteService(),
                                googlePlacesService = new google.maps.places.PlacesService(document.getElementsByClassName('fake-hidden-input')[0]);

                            autocompleteService.getPlacePredictions({input: req.address}, function(predictions, status) {
                                if (status !== google.maps.places.PlacesServiceStatus.OK) {
                                    return;
                                }

                                var promises = predictions.map(function(prediction) {
                                    var defer = $q.defer();
                                    googlePlacesService.getDetails({reference: prediction.reference}, function(details) {
                                        if (details && details.photos) {
                                            details.photos = details.photos.map(function (photo) {
                                                return photo.getUrl({'maxWidth': 320, 'maxHeight': 320});
                                            });
                                        }
                                        defer.resolve(details);
                                    });
                                    return defer.promise;
                                });

                                $q.all(promises).then(function(data) {
                                    callback(data);
                                });

                            });
                        }

                        scope.$watch('searchQuery', function(query){
                            if (searchEventTimeout) $timeout.cancel(searchEventTimeout);
                            searchEventTimeout = $timeout(function() {
                                if(!query) return;
                                if(query.length < 3);

                                var req = scope.geocodeOptions || {};
                                req.address = query;

                                scope.locations = [];

                                if (attrs.geocodeService === 'places-api') {
                                    placesGeocode(req, function(results) {
                                        results = results.filter(function(result) {
                                            return result;
                                        });                             
                                        scope.locations = alwaysShownLocations.concat(results);
                                    });
                                } else {
                                    mapsGeocode(req, function(results) {
                                        scope.$apply(function() {
                                            scope.locations = alwaysShownLocations.concat(results);
                                        });
                                    });
                                }
                            }, 350); // we're throttling the input by 350ms to be nice to google's API
                        });

                        var onClick = function(e){
                            e.preventDefault();
                            e.stopPropagation();

                            $ionicBackdrop.retain();
                            unbindBackButtonAction = $ionicPlatform.registerBackButtonAction(closeOnBackButton, 250);

                            el.element.css('display', 'block');
                            searchInputElement[0].focus();
                            setTimeout(function(){
                                searchInputElement[0].focus();
                            }, 0);
                            setTimeout(function() {
                                searchInputElement[0].focus();
                            }, 100)
                        };

                        var onCancel = function(e){
                            $ionicBackdrop.release();
                            el.element.css('display', 'none');

                            scope.searchQuery = '';
                            scope.$$phase || scope.$digest();

                            if (unbindBackButtonAction){
                                unbindBackButtonAction();
                                unbindBackButtonAction = null;
                            }
                        };

                        closeOnBackButton = function(e){
                            e.preventDefault();

                            el.element.css('display', 'none');
                            $ionicBackdrop.release();

                            if (unbindBackButtonAction){
                                unbindBackButtonAction();
                                unbindBackButtonAction = null;
                            }
                        }

                        element.bind('click', onClick);
                        element.bind('touchend', onClick);

                        el.element.find('button').bind('click', onCancel);
                    });

                    if (attrs.placeholder){
                        element.attr('placeholder', attrs.placeholder);
                    }


                    ngModel.$formatters.unshift(function (modelValue) {
                        if (!modelValue) {
                            return ''; 
                        }
                        return modelValue;
                    });

                    ngModel.$parsers.unshift(function (viewValue) {
                        return viewValue;
                    });

                    ngModel.$render = function(){
                        if (!ngModel.$viewValue) {
                            element.val('');
                        } else {
                            element.val(ngModel.$viewValue.formatted_address || ngModel.$modelValue.formatted_address || '');
                        }
                    };

                    scope.$on('$destroy', function(){
                        if (unbindBackButtonAction){
                            unbindBackButtonAction();
                            unbindBackButtonAction = null;
                        }
                    });
                }
            };
        }
    ]);
