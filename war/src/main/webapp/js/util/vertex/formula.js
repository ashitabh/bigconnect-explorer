/*
 * This file is part of the BigConnect project.
 *
 * Copyright (c) 2013-2020 MWARE SOLUTIONS SRL
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License version 3
 * as published by the Free Software Foundation with the addition of the
 * following permission added to Section 15 as permitted in Section 7(a):
 * FOR ANY PART OF THE COVERED WORK IN WHICH THE COPYRIGHT IS OWNED BY
 * MWARE SOLUTIONS SRL, MWARE SOLUTIONS SRL DISCLAIMS THE WARRANTY OF
 * NON INFRINGEMENT OF THIRD PARTY RIGHTS
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 * You should have received a copy of the GNU Affero General Public License
 * along with this program; if not, see http://www.gnu.org/licenses or write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA, 02110-1301 USA, or download the license from the following URL:
 * https://www.gnu.org/licenses/agpl-3.0.txt
 *
 * The interactive user interfaces in modified source and object code versions
 * of this program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU Affero General Public License.
 *
 * You can be released from the requirements of the license by purchasing
 * a commercial license. Buying such a license is mandatory as soon as you
 * develop commercial activities involving the BigConnect software without
 * disclosing the source code of your own applications.
 *
 * These activities include: offering paid services to customers as an ASP,
 * embedding the product in a web application, shipping BigConnect with a
 * closed source product.
 */
define([], function() {
    'use strict';

    return formulaFunction;

    function formulaFunction(formula, vertex, V, optionalKey, optionalOpts) {
        if (!optionalOpts) {
            optionalOpts = {};
        }
        optionalOpts = _.extend({}, optionalOpts, { ignoreDisplayFormula: true });

        var prop = function(name) { return V.prop(vertex, name, optionalKey, optionalOpts); },
            propRaw = function(name) { return V.propRaw(vertex, name, optionalKey, optionalOpts); },
            longestProp = function(optionalName) { return V.longestProp(vertex, optionalName); },
            props = function (name) { return V.props(vertex, name, optionalKey ); },
            anyProp = function(name) { return V.prop(vertex, name); },
            anyPropRaw = function(name) { return V.propRaw(vertex, name); };

        try {

            // If the formula is an expression wrap and return it
            if (formula.indexOf('return') === -1) {
                formula = 'return (' + formula + ')';
            }

            var scope = _.extend({}, optionalOpts.additionalScope || {}, {
                prop: prop,
                dependentProp: prop,
                propRaw: propRaw,
                longestProp: longestProp,
                props: props,
                anyProp: anyProp,
                anyPropRaw: anyPropRaw
            });

            if (V.isEdge(vertex)) {
                scope.edge = vertex;
            } else {
                scope.vertex = vertex;
            }

            var keys = [],
                values = [];

            _.each(scope, function(value, key) {
                values.push(value);
                keys.push(key);
            });

            /*eslint no-new-func:0*/
            return (new Function(keys.join(','), formula)).apply(null, values);
        } catch(e) {
            console.warn('Unable to execute formula: ' + formula + ' Reason: ', e);
        }
    }
});